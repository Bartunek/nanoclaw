# Local Customizations (this fork)

This install (`Bartunek/nanoclaw`) carries local edits on top of upstream
(`qwibitai/nanoclaw`) **and** on top of the channel code shipped on the
`channels` branch. This file is the ledger so an update never silently drops
them.

**Golden rules**
- After every `/update-nanoclaw` merge: `pnpm run build && pnpm test`, then skim
  `git diff --name-only upstream/main..HEAD` and confirm the files below still
  carry their edits. Auto-merge can drop a local line without reporting a conflict.
- **`/update-nanoclaw` always resets the customized adapters — plan to reapply.**
  As of 2.2.0 the update controller calls `refreshInstalledSkills()`
  unconditionally during `validate`, and copy directives are always-apply in
  refresh mode, so `src/channels/{github,whatsapp}.ts` are overwritten from the
  `channels` branch on every update. There is no opt-out flag. Reapply the delta
  afterwards with the patches in
  [docs/local-patches/](local-patches/README.md) — that directory is the
  authoritative recovery path. (The old rule here was "never blind-run
  `/add-github` or `/add-whatsapp`"; that is no longer sufficient, because the
  update path now runs the equivalent for you.) `/add-discord` has no local
  delta and is safe.
- Channel/provider **npm pins** (`chat`, `@chat-adapter/*`) come from
  `package.json` + `pnpm install`, **not** from re-copying adapter source. You can
  bump the pin without touching the customized `.ts`.

## Trunk/shared files with local edits (must survive `/update-nanoclaw` merges)

| File | What / why | Provenance |
|------|------------|------------|
| `src/channels/chat-sdk-bridge.ts` | Inbound attachments: when the adapter exposes only `url` and no `fetchData()` (e.g. `@chat-adapter/discord@4.29.0`), fetch the bytes host-side so `data`→inbox→`localPath` still works. Without it, Discord/GitHub/Slack image attachments reach the container as metadata only and the agent can't read them. | `4980951` |
| `src/channels/adapter.ts`, `channel-registry.ts`, `src/delivery.ts` | Per-agent `senderName` prefix threaded from delivery through the adapter registry into outbound sends. (`src/index.ts` no longer carries any of this — upstream refactored it out before 2.2.0; the row used to list it.) | `b126569` + merge-resolution commits |
| `container/Dockerfile` | Adds `gh` CLI (pinned `ARG GH_VERSION`) and the Gmail MCP server to the agent image. | `c146add` + gh-CLI commit |
| `container/skills/whatsapp-formatting/` | Restored from `upstream/channels` after 2.1.54 moved it off trunk. WhatsApp is installed and Clawie + family reference it. Copy from `upstream/channels`, **do not** re-run `/add-whatsapp`. `vercel-cli` was intentionally **not** restored (no group uses it; `vercel` is opt-in via `/add-vercel`). | `9b21b17e` |
| ~~`container/agent-runner/src/db/session-state.ts`, `mcp-tools/core.ts`, `poll-loop.ts`~~ | **RETIRED 2026-08-18 — subsumed upstream, no longer carried.** The local same-turn duplicate-delivery guard (a fingerprint ledger in outbound.db) was dropped in the 2.2.0 merge. Upstream's `pr-series/stan-midturn-delivery` solves the whole class: a provider declaring `emitsMidTurnText` (claude does) delivers only through the mid-turn door and the result door never sends content, and its `turnDelivered` check reads `chatRowWrittenSince(turnStartSeq)` so it already sees MCP `send_message` rows. Keeping the local guard on top would have swallowed upstream's nudge-and-resend path. Nothing to re-check on future updates. | retired in `2919c652` |

## Memory model (post-2.1.54)

2.1.54 introduced provider-agnostic memory (`groups/<folder>/memory/` OKF tree +
`instructions.prepend.md`). Two facts that de-risk future updates:
- The Claude provider still sets `settingSources: ['project','user','local']`
  (`container/agent-runner/src/providers/claude.ts`), so **`CLAUDE.local.md` is
  still auto-loaded** — groups relying on it did **not** lose knowledge on the
  update. Our groups' integration runbooks still live in `CLAUDE.local.md`.
- What the update **disables** is Claude's *native* auto-memory
  (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`). Clawie had 3 native-memory files
  (`user_honza`, `feedback_github_pr`, `MEMORY`); these were migrated into
  `groups/dm-with-honza/memory/` (gitignored) to preserve them. Family/Pontee had
  no native memory. A full `/migrate-memory` reorg of `CLAUDE.local.md` remains
  optional cleanup.

## Per-group additions (gitignored, but easy to lose)

`groups/*` is gitignored, so these live only on this host — a fresh clone or a
group re-scaffold will not have them.

| Path | What / why |
|------|------------|
| `groups/*/.claude/agents/advisor.md` (all three groups) | Advisor subagent (Opus) for second opinions. Loaded as a **project**-scope agent because the container's cwd is `/workspace/agent` and the Claude provider sets `settingSources: ['project','user','local']`. Verified that `claude@2.1.197` reads `.claude/agents` and exposes `subagent_type`. Calling instructions live in each group's `CLAUDE.local.md` (created for `pontee`, which had none). Per-group deltas: the calling agent's name, and a final review bullet — GitHub PR house rule for `dm-with-honza`, blast-radius-on-people for `family`/`pontee`. Subagents do **not** inherit the parent's transcript — the caller must pass context in the Task prompt. |

## Installed channel files customized beyond their `channels`-branch baseline

Re-copying these from `channels` destroys the diff shown — and as of 2.2.0
`/update-nanoclaw` does exactly that on every run (see the golden rules).
Reapply afterwards from [docs/local-patches/](local-patches/README.md).

| File | Local delta vs `channels` | Summary — see `git log -- <file>` |
|------|---------------------------|-----------------------------------|
| `src/channels/github.ts` | ~90 lines ([patch](local-patches/github-adapter-customizations.patch)) | GitHub **App** auth (not PAT), explicit `botUserId` self-filter (or bot loops on its own comments), PR-context enrichment wrapper, `gh` CLI. `GITHUB_BOT_USERNAME` must be the **bare app slug** (no `[bot]`) and tracks the app's display-name slug — update it if the app is renamed. Reapplied on top of the branch's `GITHUB_DEFAULTS` declaration in 2.2.0. |
| `src/channels/whatsapp.ts` | ~65 lines ([patch](local-patches/whatsapp-adapter-customizations.patch)) | Down to two deltas after 2.2.0: per-agent `senderName` prefix on outbound, and **inbound** emoji-reaction forwarding (`messages.reaction`) — upstream's new reactions feature is outbound-only (`react_to_message` + the `reactions` container skill), so they are complementary. Upstreamed and no longer local: `sentMessageCache` echo-dedup, `state.creds.me` pairing gate, true-logout-only creds clearing, shared/dedicated-number mode. **Dropped deliberately:** the local base64→session-inbox media path, superseded by the branch's `attachments/<file>` + `localPath` handling that matches current trunk. |
| `src/channels/whatsapp.test.ts` | synced from branch | Not in the `add-whatsapp` copy list even though `whatsapp.ts` is, so a refresh updates the adapter and strands the test — broke `pnpm run build` (TS2554) during the 2.2.0 update. Re-take it from `upstream/channels` whenever the adapter is refreshed. |

## Related

- Deeper per-topic notes live in the assistant's memory (`chat-sdk-bridge-attachment-fix`,
  `github-channel-app-auth`, `whatsapp-adapter-customization`).
- `docs/BRANCH-FORK-MAINTENANCE.md` documents upstream's own branch/fork layout
  (a different concern from this fork's local drift).
