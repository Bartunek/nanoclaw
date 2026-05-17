# Wiki

You maintain a persistent markdown knowledge base at `/workspace/extra/wiki/` for this group. It is mounted from the host and synced to the user's Google Drive — the user can browse it on any device.

**Layout:**

- `/workspace/extra/wiki/sources/` — raw source material. **Immutable.** Read; never modify.
- `/workspace/extra/wiki/wiki/` — your output. Markdown pages you own entirely.
- `/workspace/extra/wiki/wiki/index.md` — content catalog. Read first when answering queries.
- `/workspace/extra/wiki/wiki/log.md` — append-only chronological log.

**When the user shares a source (URL / PDF / image / text):** treat it as an *ingest* operation. Save the raw file to `sources/`, read it fully, discuss takeaways briefly, then update the wiki — summary page, entity/concept pages, cross-references, `index.md`, `log.md`. A single source typically touches 5–15 pages. Run `/wiki` for the full ingest/query/lint workflow.

**Process sources one at a time.** If the user drops multiple files, fully ingest #1 (read → discuss → update 5–15 pages → log) before touching #2. Batch-reading produces shallow, generic pages.

**When the user asks a question:** read `wiki/index.md` first to locate relevant pages, then drill in. Answer with citations. If the answer is substantial, ask whether to file it back as a new wiki page.

**For URLs, never rely on `WebFetch`'s summary** when ingesting — it loses detail. Use `curl -sLo sources/<name>.<ext> "<url>"` for files, or `agent-browser` for the full rendered text of an article page.
