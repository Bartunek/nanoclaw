---
name: wiki
description: >-
  Personal/group knowledge wiki (Karpathy LLM Wiki pattern). Use when the user
  asks you to ingest a source (URL/PDF/image), query the wiki, file an answer
  back into the wiki, or lint the wiki for health. The wiki lives at
  /workspace/extra/wiki/ and persists across sessions.
---

# Wiki — Karpathy LLM Wiki pattern

You maintain a persistent, structured markdown knowledge base for this group. The wiki is **not** a chat log — it's a compounding, cross-referenced artifact you own and revise as new material arrives.

## Layout

```
/workspace/extra/wiki/
├── wiki/         ← your output. Markdown pages, you own these entirely.
│   ├── index.md  ← catalog of all pages, organized by category
│   ├── log.md    ← append-only chronological record
│   └── …         ← entity/concept/summary/comparison pages
└── sources/      ← raw source material. Immutable. Read; never modify.
```

The host syncs `~/nanoclaw-wikis/<group>/` to Google Drive, so the user can browse on any device.

## The three operations

### Ingest

When the user sends a source (URL, PDF, image, text), or points at a file already in `sources/`:

1. **Acquire the source.** For URLs: `curl -sLo sources/<descriptive-name>.<ext> "<url>"` for files; for webpages where the article content is what matters, use `agent-browser` (or `curl | pandoc`) to get the full text — never settle for `WebFetch`'s summary, which loses detail. For PDFs and images shared in chat, save them into `sources/` first.
2. **Read it fully.**
3. **Discuss takeaways briefly with the user** before writing — flag anything that contradicts existing wiki content.
4. **Update the wiki** in one pass. A single source typically touches 5–15 pages:
   - Create or update a **summary page** for the source itself in `wiki/`.
   - Update/create **entity pages** (people, places, organizations, products) mentioned.
   - Update/create **concept pages** (ideas, frameworks, terms).
   - Add **cross-references** (`[[link]]` or `[text](path.md)`) between related pages.
   - Update `wiki/index.md` — add new pages under the right category.
   - Append a `wiki/log.md` entry: `## [YYYY-MM-DD] ingest | <source title>` + 2–3 line note of what changed.

### Query

When asked a question:

1. Read `wiki/index.md` first to locate relevant pages.
2. Drill into those pages, follow cross-references.
3. Answer with citations to the pages you used.
4. If the answer is substantial (new comparison, synthesis, exploration), ask whether to file it back as a new wiki page — exploration compounds rather than vanishing into chat.

### Lint

Periodic health check (manual or scheduled):

- Contradictions across pages → flag, propose resolution.
- Stale claims superseded by newer sources.
- Orphan pages (no inbound links from index or other pages).
- Concepts mentioned often but lacking dedicated pages.
- Missing cross-references between related pages.
- Data gaps the user might want to investigate.

Output a punch list. Don't unilaterally rewrite — surface for the user.

## Discipline (critical)

**Process sources one at a time.** If the user drops 5 PDFs, do all the ingest work for #1 (read → discuss → update 5–15 pages → log) before touching #2. Batch-reading produces shallow, generic pages instead of the deep integration that makes the wiki valuable.

**Prefer many small revisions over one big page.** A page on "Dad's surgery" should link to entity pages for the doctor, the hospital, the medication — not include everything inline.

**Cross-reference aggressively.** Every new page should link to at least one existing page; existing pages should be updated to link back.

**Never modify `sources/`.** Those are immutable. If a source needs annotation, write it in `wiki/` and cite the source path.

**Log every meaningful action** in `wiki/log.md`. Future-you reads this to understand recent activity.

## Source handling

- **URLs / articles** → `curl` to `sources/`, or use `agent-browser` for the full rendered page.
- **PDFs** → save to `sources/`, read natively.
- **Images / screenshots** → save to `sources/`, view directly.
- **No transcription tool installed** — if a voice note arrives, tell the user to install one (e.g. `/add-voice-transcription` if available) before ingesting audio.
