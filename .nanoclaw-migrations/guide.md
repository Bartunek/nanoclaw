# NanoClaw Migration Guide

Generated: 2026-05-17
Base (merge-base): `93ec82c`
HEAD at generation: `9c48b83`
Upstream HEAD at generation: `78bb6cb`

Last applied: 2026-05-17 — upgraded to upstream `78bb6cb`, post-upgrade HEAD `c1bb230` (squash of all customizations) + `0fa0ac3` (guide carry-forward).

## Migration Plan

Order of operations:

1. **Worktree from clean `upstream/main`**.
2. **Reapply install skills** in the worktree (each is idempotent):
   - `/add-whatsapp` — brings `src/channels/whatsapp.ts`, `setup/whatsapp-auth.ts`, registration in `src/channels/index.ts`, the `container/skills/reactions/` skill, and Baileys/qrcode/pino deps. Already includes the `resolveWaWebVersion` wppconnect workaround on `upstream/channels` — no port needed.
   - `/add-discord` — `src/channels/discord.ts` + registration.
   - `/add-github` — `src/channels/github.ts` + registration.
   - `/add-karpathy-llm-wiki` — `container/skills/wiki/SKILL.md` + `instructions.md`.
   - `/add-gcal-tool` — installs `@cocal/google-calendar-mcp` in the Dockerfile (replaces the manual Dockerfile patch below if the skill does it; otherwise apply the patch).
3. **Reapply source customizations** (Dashboard).
4. **Adopt upstream `.gitignore` stance** — `groups/*` becomes fully ignored. Untrack any currently-tracked `groups/` files via `git rm --cached -r groups/`. The filesystem content stays put.
5. **Validate** — `pnpm install && pnpm run build && pnpm test`.
6. **Rebuild container image** — `./container/build.sh`.
7. **Swap into main tree** — `git reset --hard <upgrade-commit>`. Untracked filesystem state (`groups/`, `data/`, `.env`) survives.
8. **First-boot DB backfill** — upstream's `src/backfill-container-configs.ts` migrates existing `groups/*/container.json` into the new `container_configs` table on startup. Confirm with `pnpm exec tsx scripts/q.ts data/v2.db "SELECT agent_group_id FROM container_configs"`.

Risks:
- `src/index.ts` is the only deep conflict zone (Dashboard block goes after upstream's new CLI socket server). Reapply by hand on the upstream file.
- `groups/*/container.json` is gitignored on both sides — these files are install state and stay on disk through the upgrade. Loss requires manual recreation; verify they exist on disk before the swap.
- Container-config refactor moves config from `groups/*/container.json` (filesystem) to `container_configs` table. After the upgrade, edits go through `ncl` CLI or DB. Existing `container.json` files act as one-shot backfill source on first boot.

## Applied Skills

These reapply by re-running the upstream install skills (each clones from `upstream/channels` or `upstream/skill/<name>` and wires registration):

- `/add-whatsapp` — also brings reactions skill (`container/skills/reactions/`)
- `/add-discord`
- `/add-github`
- `/add-karpathy-llm-wiki`
- `/add-gcal-tool` — if it now exists upstream

Custom skills (user-authored, not from upstream): none. The `wiki` skill is upstream-authored via `/add-karpathy-llm-wiki`; the `reactions` skill ships with the WhatsApp adapter.

## Skill Interactions

None known. The WhatsApp adapter is the only one that brings a container skill (`reactions/`). The wiki skill is independent.

## Modifications to Applied Skills

None. All applied skills are used as-is from upstream.

## Customizations

### 1. Dashboard integration (KEEP)

**Intent:** Run the optional `@nanoco/nanoclaw-dashboard` web UI alongside the host, pushing periodic state snapshots (agents, sessions, channels, log tail) to it. Gated by `DASHBOARD_SECRET` in `.env`.

**Files:** `src/dashboard-pusher.ts` (new), `src/index.ts` (integration), `package.json` (dependency).

**How to apply:**

1. Copy `src/dashboard-pusher.ts` verbatim from the pre-migration tree (the entire 578-line file). It imports from `./db/agent-groups.js`, `./db/sessions.js`, `./db/messaging-groups.js`, `./modules/agent-to-agent/db/agent-destinations.js`, `./modules/permissions/db/*`, `./channels/channel-registry.js` — all paths still exist on upstream HEAD.

2. In `src/index.ts`:

   a. Add import after the `runMigrations` import:
   ```ts
   import { readEnvFile } from './env.js';
   ```

   b. After upstream's CLI socket-server block (`startCliServer(...)` around section 7) and before the `log.info('NanoClaw running')` end line, insert (renumber as appropriate — likely section 8):
   ```ts
   // 8. Dashboard (optional)
   const dashboardEnv = readEnvFile(['DASHBOARD_SECRET', 'DASHBOARD_PORT']);
   const dashboardSecret = process.env.DASHBOARD_SECRET || dashboardEnv.DASHBOARD_SECRET;
   const dashboardPort = parseInt(process.env.DASHBOARD_PORT || dashboardEnv.DASHBOARD_PORT || '3100', 10);
   if (dashboardSecret) {
     const { startDashboard } = await import('@nanoco/nanoclaw-dashboard');
     const { startDashboardPusher } = await import('./dashboard-pusher.js');
     startDashboard({ port: dashboardPort, secret: dashboardSecret });
     startDashboardPusher({ port: dashboardPort, secret: dashboardSecret, intervalMs: 60000 });
   } else {
     log.info('Dashboard disabled (no DASHBOARD_SECRET)');
   }
   ```

3. In `package.json` `dependencies`, add:
   ```json
   "@nanoco/nanoclaw-dashboard": "^0.3.0"
   ```

4. `pnpm install` to refresh the lockfile.

### 2. Google Calendar MCP in container image

**Intent:** Bake `@cocal/google-calendar-mcp@2.6.1` into the container so any group that wires it via container_config (or legacy `container.json`) gets calendar tools.

**Files:** `container/Dockerfile`.

**How to apply:**

If `/add-gcal-tool` skill installs this for you (check skill content first), just run the skill. Otherwise, edit `container/Dockerfile`:

1. After `ARG BUN_VERSION=1.3.12`, add:
   ```
   ARG CALENDAR_MCP_VERSION=2.6.1
   ```

2. After upstream's `pnpm install -g "@anthropic-ai/claude-code@..."` block (and after the new `ncl` CLI wrapper block that upstream introduces), add:
   ```
   RUN --mount=type=cache,target=/root/.cache/pnpm \
       pnpm install -g "@cocal/google-calendar-mcp@${CALENDAR_MCP_VERSION}"
   ```

Accept upstream's `CLAUDE_CODE_VERSION` bump from `2.1.116` → `2.1.128`.

### 3. Adopt upstream `.gitignore` stance for groups/

**Intent:** Stop tracking `groups/<group>/CLAUDE.md` / `CLAUDE.local.md` in git — align with upstream's "groups are install-only" stance. (Previous fork tracked them deliberately; user has reversed that decision.)

**Files:** `.gitignore`, plus `git rm --cached -r groups/` to untrack already-committed content.

**How to apply:**

1. Use upstream's `.gitignore` verbatim. No edits needed — `groups/*` is already fully ignored upstream.

2. After the swap into the main tree, if `git ls-files groups/` returns anything, untrack it:
   ```bash
   git rm --cached -r groups/
   git commit -m "chore: stop tracking groups/ (adopt upstream stance)"
   ```
   The files stay on disk; only the index entries are removed.

## Filesystem-only state (preserved through `git reset --hard`)

These are NOT in the git tree post-migration but must exist on disk for the upgraded install to work. Verify before the swap and after:

- `groups/dm-with-honza/` — Clawie agent group
  - `CLAUDE.md`, `CLAUDE.local.md` — agent persona
  - `ms-todo-mcp.mjs` — custom MS To Do MCP server (ported from v1, no upstream skill)
  - `container.json` — MCP servers (notion, microsoft-todo, rohlik, calendar) + wiki/calendar mounts. Will be backfilled into `container_configs` DB table on first boot post-upgrade.

- `groups/family/` — Claw agent group
  - `CLAUDE.md`, `CLAUDE.local.md`
  - `ms-todo-mcp.mjs`
  - `container.json`

- `groups/pontee/` — Pontee agent group
  - `CLAUDE.md`, `CLAUDE.local.md`
  - `container.json` (no MS To Do for Pontee — only calendar + wiki)

- `data/v2.db` — central DB (users, agent_groups, messaging_groups, wirings, user_roles, etc.). Migrations 014 (container-configs) and 015 (cli-scope) will run on first boot.

- `data/v2-sessions/*/` — per-session inbound/outbound DBs.

- `.env` — credentials and config. Includes `INSTALL_CJK_FONTS=false` (default), no `ASSISTANT_HAS_OWN_NUMBER` (defaults to false — bot uses user's WhatsApp account via Baileys).

- `~/.calendar-mcp/{gcp-oauth.keys.json,credentials.json}` — OneCLI stub creds for Google Calendar MCP.

- `~/nanoclaw-wikis/{dm-with-honza,family,pontee}/` — wiki sources mounted into containers, synced to Google Drive via systemd timer.

- `~/.config/nanoclaw/mount-allowlist.json` — allows `~/nanoclaw-wikis` and `~/.calendar-mcp` mounts.

- `~/.onecli/{.env,docker-compose.yml}` — bind-host pinning and APP_URL decoupling for OAuth redirect-URI compatibility.

- systemd: `~/.config/systemd/user/nanoclaw-wiki-sync.{service,timer}` — every-30-min rclone bisync.

## Custom DB state to preserve

These rows in `data/v2.db` are install-specific but NOT in git. Verify they're intact post-migration:

- `messaging_group_agents` engage rules — notably Lobster (`mg-1778314565283-8fl8qj`) has `engage_mode='pattern'`, `engage_pattern='.'`, `ignored_message_policy='drop'` (changed from `mention` in this session).
- `user_roles` — owner + admin grants.
- `agent_group_members` — unprivileged access list.

## Stale-state hunks (intentionally NOT preserved)

These appear in the local diff but should be dropped on reapply — upstream has converged:

- `src/delivery.test.ts`, `src/host-core.test.ts`, `src/modules/agent-to-agent/agent-route.test.ts` — prettier reformatting already on upstream.
- `src/channels/*.ts` — channel adapter files; come from `/add-*` skills.
- `setup/whatsapp-auth.ts`, `setup/groups.ts` — come from `/add-whatsapp`.
- `src/channels/index.ts` registration entries — auto-appended by install skills.
- Discord/GitHub package.json deps — pinned by their install skills.
