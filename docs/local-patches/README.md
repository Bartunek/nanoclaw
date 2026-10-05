# Local adapter patches

`src/channels/github.ts` and `src/channels/whatsapp.ts` are installed from the
`channels` registry branch and carry local customizations on top. **Every
`/update-nanoclaw` run resets both files to the branch baseline** — the update
controller calls `refreshInstalledSkills()` unconditionally during `validate`,
and `scripts/skill-apply.ts` treats copy directives as always-apply in refresh
mode. There is no flag to opt a file out.

So the rule is not "don't refresh" (you can't prevent it) — it is **reapply the
delta after every refresh**.

## Reapplying

The `.patch` files here are the local delta against the refreshed baseline
`b4511353` (the post-refresh, pre-reapply commit of the 2.2.0 update). Both are
round-trip tested: applying them to a `b4511353` worktree reproduces the current
files byte-for-byte.

```bash
git apply --3way docs/local-patches/github-adapter-customizations.patch
git apply --3way docs/local-patches/whatsapp-adapter-customizations.patch
pnpm run build && pnpm test
```

If `--3way` conflicts, the channels branch moved under the customization —
resolve by hand, keeping the branch's new code and re-grafting the local bits
below, then regenerate the patch:

```bash
git diff <refresh-commit> HEAD -- src/channels/github.ts > docs/local-patches/github-adapter-customizations.patch
```

## What the deltas are

**github.ts**
- GitHub App auth (`appId` / `installationId` / `privateKey`), PAT fallback kept.
- Explicit `botUserId` self-filter. App installation tokens cannot call
  `GET /user`, so the adapter can't discover its own id — without this the bot
  replies to its own comments in a loop.
- PR/issue context enrichment wrapper (`withContextEnrichment`), which prepends
  the PR/issue coordinates + a `gh` hint to inbound messages.

**whatsapp.ts** — one delta remains.

Two former deltas were **absorbed upstream during the 2.3.0 update** and are no
longer carried here: the per-agent `senderName` prefix, and inbound
emoji-reaction forwarding (`messages.reaction`). Both now exist on the
`channels` branch, verified by diffing the refreshed file against
`upstream/channels`. Do not re-add them — you would duplicate upstream
behaviour.

- **Inbound attachments staged into the session inbox.** The branch writes
  downloaded media to a global `DATA_DIR/attachments` and passes
  `localPath: attachments/<file>`, which `container/agent-runner/src/formatter.ts`
  renders to the agent as `/workspace/attachments/<file>` — **a path nothing
  mounts**. The agent is told about a file it cannot open, with no error
  anywhere: the download succeeds, the row looks right, the file just isn't
  reachable. The delta passes the bytes as inline base64 instead, so the host's
  `writeSessionMessage` → `extractAttachmentFiles` stages them into that
  session's `inbox/<msgId>/` (the session dir *is* `/workspace`) and rewrites
  `localPath`. Same thing `chat-sdk-bridge.ts` does for Discord. 30MB inline
  cap, matching the bridge; larger media is dropped with a failure note.

  **Do not "fix" this by mounting `DATA_DIR/attachments` instead.** That
  directory is shared by every agent group, so mounting it would expose every
  chat's attachments to every agent — including stakeholder-facing ones like
  Falco. Per-session staging is the isolation boundary, not a detail.

## Watch out

`src/channels/whatsapp.test.ts` is **not** in the `add-whatsapp` copy list while
`whatsapp.ts` is, so a refresh updates the adapter and leaves its unit test
stale — that breaks `pnpm run build` with TS2554 when helper signatures change.
Fix by taking the test from the branch alongside the adapter:

```bash
git show upstream/channels:src/channels/whatsapp.test.ts > src/channels/whatsapp.test.ts
```

## History

The attachment delta was lost once already. During the 2.2.0 update it was
dropped on the reasoning that the branch's `attachments/<file>` + `localPath`
handling superseded it, and the ledger recorded that as deliberate. It did not
supersede anything — the mount it assumes does not exist here. The breakage was
silent until someone forwarded a document to Clawie eight days later and the
agent could not read it.

During the 2.3.0 update all three whatsapp deltas were wiped by the skill
refresh again (`copy: fetch channels → refresh src/channels/whatsapp.ts`). This
time each was checked against `upstream/channels` before reapplying: two were
genuinely upstream now, the attachment one was not. That check is the routine —
diff the refreshed file against the pristine branch copy, per delta, and only
reapply what is actually missing.

The lesson for the next refresh: a local delta that looks redundant against new
upstream code may be the only thing making that code work in this install. Test
the behaviour before dropping the patch, rather than reading both versions and
judging them equivalent.
