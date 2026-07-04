# Local Customizations (this fork)

This install (`Bartunek/nanoclaw`) carries local edits on top of upstream
(`qwibitai/nanoclaw`) **and** on top of the channel code shipped on the
`channels` branch. This file is the ledger so an update never silently drops
them.

**Golden rules**
- After every `/update-nanoclaw` merge: `pnpm run build && pnpm test`, then skim
  `git diff --name-only upstream/main..HEAD` and confirm the files below still
  carry their edits. Auto-merge can drop a local line without reporting a conflict.
- **Never blind-run `/add-github` or `/add-whatsapp`.** They overwrite the whole
  adapter file from the `channels` branch and would erase the customizations
  below. `/add-discord` is currently a no-op (no local delta) and safe.
- Channel/provider **npm pins** (`chat`, `@chat-adapter/*`) come from
  `package.json` + `pnpm install`, **not** from re-copying adapter source. You can
  bump the pin without touching the customized `.ts`.

## Trunk/shared files with local edits (must survive `/update-nanoclaw` merges)

| File | What / why | Provenance |
|------|------------|------------|
| `src/channels/chat-sdk-bridge.ts` | Inbound attachments: when the adapter exposes only `url` and no `fetchData()` (e.g. `@chat-adapter/discord@4.29.0`), fetch the bytes host-side so `data`→inbox→`localPath` still works. Without it, Discord/GitHub/Slack image attachments reach the container as metadata only and the agent can't read them. | `4980951` |
| `src/channels/adapter.ts`, `channel-registry.ts`, `src/delivery.ts`, `src/index.ts` | Per-agent `senderName` prefix threaded from delivery through the adapter registry into outbound sends. | `b126569` + merge-resolution commits |
| `container/Dockerfile` | Adds `gh` CLI (pinned `ARG GH_VERSION`) and the Gmail MCP server to the agent image. | `c146add` + gh-CLI commit |

## Installed channel files customized beyond their `channels`-branch baseline

Re-copying these from `channels` (via `/add-<name>`) destroys the diff shown.

| File | Local delta vs `channels` | Summary — see `git log -- <file>` |
|------|---------------------------|-----------------------------------|
| `src/channels/github.ts` | ~81 lines | GitHub **App** auth (not PAT), explicit `botUserId` self-filter (or bot loops on its own comments), PR-context enrichment wrapper, `gh` CLI. `GITHUB_BOT_USERNAME` must be the **bare app slug** (no `[bot]`) and tracks the app's display-name slug — update it if the app is renamed. |
| `src/channels/whatsapp.ts` | ~120 lines | Native Baileys adapter with per-agent `senderName`, emoji reactions, `sentMessageCache` echo-dedup, inbound media routed through the session inbox, `state.creds.me` pairing gate, true-logout-only creds clearing. NOTE: `/add-whatsapp` also references `origin/channels` (nonexistent here) and would fail outright. |

## Related

- Deeper per-topic notes live in the assistant's memory (`chat-sdk-bridge-attachment-fix`,
  `github-channel-app-auth`, `whatsapp-adapter-customization`).
- `docs/BRANCH-FORK-MAINTENANCE.md` documents upstream's own branch/fork layout
  (a different concern from this fork's local drift).
