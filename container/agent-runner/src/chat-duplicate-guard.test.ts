/**
 * Same-turn double-delivery guard for chat sessions.
 *
 * Task runs solve this by barring final-text delivery outright (see
 * task-delivery.test.ts). Chat sessions need both paths — a mid-turn
 * `send_message` ack *and* a final `<message to>` reply are both legitimate —
 * so the guard is narrower: drop a final-text block only when it repeats what
 * the tool already sent to that destination during the same turn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { closeSessionDb, getInboundDb, initTestSessionDb } from './db/connection.js';
import { getUndeliveredMessages } from './db/messages-out.js';
import { clearTurnSends } from './db/session-state.js';
import { sendMessage } from './mcp-tools/core.js';
import { dispatchResultText } from './poll-loop.js';
import type { RoutingContext } from './formatter.js';

function seedDestination(name: string, channelType: string, platformId: string): void {
  getInboundDb()
    .prepare(
      `INSERT INTO destinations (name, display_name, type, channel_type, platform_id, agent_group_id)
       VALUES (?, ?, 'channel', ?, ?, NULL)`,
    )
    .run(name, name, channelType, platformId);
}

const chatRouting: RoutingContext = {
  platformId: '120363408248382056@g.us',
  channelType: 'whatsapp',
  threadId: null,
  inReplyTo: 'in-1',
  taskRun: false,
};

const BODY = 'Ty události už jsou přímo v kalendáři "Rodina" – nic dalšího není potřeba 👍';

async function toolSend(to: string, text: string): Promise<void> {
  await sendMessage.handler({ to, text });
}

beforeEach(() => {
  initTestSessionDb();
  seedDestination('lobster', 'whatsapp', '120363408248382056@g.us');
  clearTurnSends();
});

afterEach(() => {
  closeSessionDb();
});

describe('chat-session duplicate suppression', () => {
  it('drops a final-text block echoing a send_message from the same turn', async () => {
    await toolSend('lobster', BODY);
    const { sent } = dispatchResultText(`<message to="lobster">${BODY}</message>`, chatRouting);

    expect(sent).toBe(0);
    expect(getUndeliveredMessages().length).toBe(1);
  });

  it('ignores whitespace differences introduced by the XML envelope', async () => {
    await toolSend('lobster', BODY);
    const { sent } = dispatchResultText(`<message to="lobster">\n  ${BODY}\n</message>`, chatRouting);

    expect(sent).toBe(0);
    expect(getUndeliveredMessages().length).toBe(1);
  });

  it('still delivers a final-text block with different content', async () => {
    await toolSend('lobster', 'Mrkám, chvilku.');
    const { sent } = dispatchResultText(`<message to="lobster">${BODY}</message>`, chatRouting);

    expect(sent).toBe(1);
    expect(getUndeliveredMessages().length).toBe(2);
  });

  it('does not suppress across turns — the ledger is per-turn', async () => {
    await toolSend('lobster', BODY);
    clearTurnSends(); // what the poll loop does at the next batch

    const { sent } = dispatchResultText(`<message to="lobster">${BODY}</message>`, chatRouting);

    expect(sent).toBe(1);
    expect(getUndeliveredMessages().length).toBe(2);
  });

  it('scopes the ledger per destination', async () => {
    seedDestination('honza', 'whatsapp', '420730165799@s.whatsapp.net');
    await toolSend('lobster', BODY);

    const { sent } = dispatchResultText(`<message to="honza">${BODY}</message>`, chatRouting);

    expect(sent).toBe(1);
    expect(getUndeliveredMessages().length).toBe(2);
  });
});
