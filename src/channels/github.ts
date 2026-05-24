/**
 * GitHub channel adapter (v2) — uses Chat SDK bridge.
 * PR comment threads as conversations.
 * Self-registers on import.
 */
import { createGitHubAdapter } from '@chat-adapter/github';

import type { ChannelAdapter, ChannelSetup, InboundMessage } from './adapter.js';
import { readEnvFile } from '../env.js';
import { createChatSdkBridge } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

/**
 * The router strips thread_id before the agent sees a message (see
 * container/agent-runner formatter), so a GitHub comment arrives with no clue
 * which PR/issue it's on — only the repo (via the destination name). We parse
 * the coordinates out of the thread_id and prepend them, plus a one-line `gh`
 * hint, so the agent can fetch real context (gh runs in the container with a
 * read credential injected by the OneCLI gateway).
 *
 * Thread id formats (from @chat-adapter/github encodeThreadId):
 *   PR:             github:{owner}/{repo}:{prNumber}
 *   Issue:          github:{owner}/{repo}:issue:{issueNumber}
 *   Review comment: github:{owner}/{repo}:{prNumber}:rc:{reviewCommentId}
 */
function githubContextPrefix(threadId: string | null): string | null {
  if (!threadId?.startsWith('github:')) return null;
  const rest = threadId.slice('github:'.length);
  const firstColon = rest.indexOf(':');
  if (firstColon === -1) return null;
  const repo = rest.slice(0, firstColon); // owner/repo
  const tail = rest.slice(firstColon + 1);
  const isIssue = tail.startsWith('issue:');
  const number = (isIssue ? tail.slice('issue:'.length) : tail).split(':')[0];
  if (!repo.includes('/') || !/^\d+$/.test(number)) return null;
  if (isIssue) {
    return `[GitHub issue ${repo}#${number} — run \`gh issue view ${number} -R ${repo} --comments\` to read it.]`;
  }
  return `[GitHub PR ${repo}#${number} — run \`gh pr view ${number} -R ${repo}\` and \`gh pr diff ${number} -R ${repo}\` to read it.]`;
}

/** Wrap the bridge so inbound GitHub messages carry their PR/issue coordinates. */
function withContextEnrichment(adapter: ChannelAdapter): ChannelAdapter {
  const originalSetup = adapter.setup.bind(adapter);
  adapter.setup = (config: ChannelSetup) => {
    const wrapped: ChannelSetup = {
      ...config,
      onInbound: (platformId: string, threadId: string | null, message: InboundMessage) => {
        const prefix = githubContextPrefix(threadId);
        const content = message.content as { text?: unknown } | null;
        if (prefix && content && typeof content.text === 'string') {
          content.text = `${prefix}\n\n${content.text}`;
        }
        return config.onInbound(platformId, threadId, message);
      },
    };
    return originalSetup(wrapped);
  };
  return adapter;
}

registerChannelAdapter('github', {
  factory: () => {
    const env = readEnvFile([
      'GITHUB_TOKEN',
      'GITHUB_WEBHOOK_SECRET',
      'GITHUB_BOT_USERNAME',
      'GITHUB_APP_ID',
      'GITHUB_APP_INSTALLATION_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_BOT_USER_ID',
    ]);
    const base = {
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      userName: env.GITHUB_BOT_USERNAME,
      // App installation tokens can't call GET /user, so the adapter can't
      // auto-discover its own id for self-message filtering. Supply it
      // explicitly to prevent the bot from looping on its own comments.
      ...(env.GITHUB_BOT_USER_ID ? { botUserId: Number(env.GITHUB_BOT_USER_ID) } : {}),
    };
    let githubAdapter;
    if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_APP_INSTALLATION_ID) {
      // Single-tenant GitHub App auth. Private key is PEM; \n in .env is decoded to real newlines.
      githubAdapter = createGitHubAdapter({
        ...base,
        appId: env.GITHUB_APP_ID,
        installationId: Number(env.GITHUB_APP_INSTALLATION_ID),
        privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else if (env.GITHUB_TOKEN) {
      githubAdapter = createGitHubAdapter({ ...base, token: env.GITHUB_TOKEN });
    } else {
      return null;
    }
    const bridge = createChatSdkBridge({ adapter: githubAdapter, concurrency: 'queue', supportsThreads: true });
    return withContextEnrichment(bridge);
  },
});
