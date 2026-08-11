/**
 * Persistent key/value state for the container. Lives in outbound.db
 * (container-owned, already scoped per channel/thread).
 *
 * Primary use: remember each provider's opaque continuation id so the
 * agent's conversation resumes across container restarts. Keyed per
 * provider because continuations are provider-private — a Claude
 * conversation id means nothing to Codex and vice versa. Switching
 * providers is therefore lossless: each provider's last thread stays
 * on file and resumes cleanly if the user flips back.
 */
import { getOutboundDb } from './connection.js';

const LEGACY_KEY = 'sdk_session_id';

function continuationKey(providerName: string): string {
  return `continuation:${providerName.toLowerCase()}`;
}

function getValue(key: string): string | undefined {
  const row = getOutboundDb()
    .prepare('SELECT value FROM session_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

function setValue(key: string, value: string): void {
  getOutboundDb()
    .prepare('INSERT OR REPLACE INTO session_state (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, value, new Date().toISOString());
}

function deleteValue(key: string): void {
  getOutboundDb().prepare('DELETE FROM session_state WHERE key = ?').run(key);
}

/**
 * One-time migration of the pre-per-provider continuation row.
 *
 * Before this was keyed per provider, continuations lived under the
 * single key `sdk_session_id`. On container start, if that legacy row
 * exists and the current provider has no continuation of its own, adopt
 * the legacy value into the current provider's slot (best-guess — the
 * legacy row was written by whatever provider ran last). The legacy row
 * is always deleted so future provider flips never re-read a stale id
 * through the wrong lens.
 *
 * Returns the continuation the caller should use at startup (either the
 * current provider's existing value, the adopted legacy value, or
 * undefined).
 */
export function migrateLegacyContinuation(providerName: string): string | undefined {
  const legacy = getValue(LEGACY_KEY);
  const currentKey = continuationKey(providerName);
  const current = getValue(currentKey);

  if (legacy === undefined) return current;

  // Always drop the legacy row so no future provider reads it.
  deleteValue(LEGACY_KEY);

  // Prefer the current provider's own slot if one already exists.
  if (current !== undefined) return current;

  setValue(currentKey, legacy);
  return legacy;
}

export function getContinuation(providerName: string): string | undefined {
  return getValue(continuationKey(providerName));
}

export function setContinuation(providerName: string, id: string): void {
  setValue(continuationKey(providerName), id);
}

export function clearContinuation(providerName: string): void {
  deleteValue(continuationKey(providerName));
}

/**
 * The a2a reply stamp: the id of the first inbound message in the batch the
 * agent is currently processing. The poll loop publishes it at batch start;
 * MCP tools (`send_message`, `send_file`) read it and stamp it onto outbound
 * rows so the host's a2a return-path routing can correlate replies back to
 * the originating session.
 *
 * This lives in outbound.db rather than module state because the MCP server
 * runs as a separate stdio subprocess from the poll loop — module state set
 * by the poll loop is invisible to it. Both processes open outbound.db
 * (journal_mode=DELETE + busy_timeout make intra-container access safe).
 */
const IN_REPLY_TO_KEY = 'current_in_reply_to';

/**
 * Ignore a stamp older than this. The poll loop clears the stamp in a
 * finally, but a container killed mid-batch (SIGKILL) can leave one behind;
 * the guard stops a later out-of-batch read from picking up a dead stamp.
 * Generous so a long-running batch's late sends still stamp correctly.
 */
const IN_REPLY_TO_MAX_AGE_MS = 30 * 60 * 1000;

export function setCurrentInReplyTo(id: string | null): void {
  if (id === null) {
    clearCurrentInReplyTo();
    return;
  }
  setValue(IN_REPLY_TO_KEY, id);
}

export function clearCurrentInReplyTo(): void {
  deleteValue(IN_REPLY_TO_KEY);
}

export function getCurrentInReplyTo(): string | null {
  const row = getOutboundDb()
    .prepare('SELECT value, updated_at FROM session_state WHERE key = ?')
    .get(IN_REPLY_TO_KEY) as { value: string; updated_at: string } | undefined;
  if (!row) return null;
  const age = Date.now() - new Date(row.updated_at).getTime();
  if (!Number.isFinite(age) || age > IN_REPLY_TO_MAX_AGE_MS) return null;
  return row.value;
}

/**
 * Same-turn send ledger — the chat-session half of the double-delivery guard.
 *
 * A turn has two delivery paths: the `send_message` MCP tool (mid-turn) and
 * `<message to="name">` blocks in the final text. Nothing stops an agent from
 * using both for the *same* content, which lands in the channel as the message
 * sent twice, seconds apart. `dispatchResultText` already refuses final-text
 * blocks outright in task runs ("one door"); chat sessions need both paths, so
 * they get this narrower rule instead: a final-text block is dropped only when
 * it repeats something the tool already sent to that destination this turn.
 *
 * Lives in outbound.db for the same reason the in-reply-to stamp does — the
 * MCP server writes it from a separate process than the poll loop that reads it.
 */
const TURN_SENDS_KEY = 'turn_sends';

/** Bounded so a runaway turn can't grow the row without limit. */
const TURN_SENDS_MAX = 50;

/**
 * Whitespace-insensitive: the same body routinely differs between the two
 * paths by indentation or a leading newline picked up from the XML envelope.
 */
function sendFingerprint(destination: string, text: string): string {
  return `${destination}\n${text.replace(/\s+/g, ' ').trim()}`;
}

function readTurnSends(): string[] {
  const row = getOutboundDb()
    .prepare('SELECT value, updated_at FROM session_state WHERE key = ?')
    .get(TURN_SENDS_KEY) as { value: string; updated_at: string } | undefined;
  if (!row) return [];
  // Reuse the in-reply-to staleness bound: a container SIGKILLed mid-batch
  // leaves the row behind, and a stale ledger must never suppress a real send.
  // Consequence: a chat turn running past this bound loses the guard and can
  // double-deliver again. Deliberate — failing open beats suppressing a real
  // message, and long runs are task runs, which the taskRun branch covers.
  const age = Date.now() - new Date(row.updated_at).getTime();
  if (!Number.isFinite(age) || age > IN_REPLY_TO_MAX_AGE_MS) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Record a tool-path delivery so the final-text path can recognize an echo. */
export function recordTurnSend(destination: string, text: string): void {
  const sends = readTurnSends();
  sends.push(sendFingerprint(destination, text));
  setValue(TURN_SENDS_KEY, JSON.stringify(sends.slice(-TURN_SENDS_MAX)));
}

export function wasSentThisTurn(destination: string, text: string): boolean {
  return readTurnSends().includes(sendFingerprint(destination, text));
}

export function clearTurnSends(): void {
  deleteValue(TURN_SENDS_KEY);
}
