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

The `.patch` files here are the local delta against the refreshed baseline, as
of the 2.2.0 update (`b4511353` → `a004760f`):

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

**whatsapp.ts**
- Per-agent `senderName` prefix on outbound (upstream prefixes with the global
  `ASSISTANT_NAME` only, so every agent posts under one name).
- Inbound emoji-reaction forwarding (`messages.reaction`). Upstream's reactions
  feature is outbound-only (the `react_to_message` tool + `reactions` container
  skill), so this is complementary, not a duplicate.

## Watch out

`src/channels/whatsapp.test.ts` is **not** in the `add-whatsapp` copy list while
`whatsapp.ts` is, so a refresh updates the adapter and leaves its unit test
stale — that breaks `pnpm run build` with TS2554 when helper signatures change.
Fix by taking the test from the branch alongside the adapter:

```bash
git show upstream/channels:src/channels/whatsapp.test.ts > src/channels/whatsapp.test.ts
```
