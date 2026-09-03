# Working on PDF Palette

## Cost discipline

Token cost here is dominated by three things, in this order. Treat these as rules,
not preferences.

1. **Never render page images to check output.** Verify numerically instead:
   extract text with PyMuPDF, count `<a:blip>` in `word/document.xml`, sample
   pixels, compare byte strings, check file sizes. A single screenshot costs more
   than the whole verification script that replaces it. Render an image only when
   the user asks, or when a defect is genuinely invisible to any numeric check —
   and say why in one line.
2. **Patch, don't rewrite.** Editing a file echoes its new contents back into
   context. A 300-line `Write` is 300 lines of cost twice over. Use targeted
   edits, even when creating a large file feels simpler.
3. **Truncate every command.** Pipe through `tail`/`head`, grep for the lines that
   matter. Never dump a diff, a file, a test log or `git show` output in full.

Also: don't re-read files already in context, batch independent tool calls into
one message, and keep commit messages to what a reader needs.

Long sessions get more expensive per turn because the whole history replays. When
a session has run long and the current task is self-contained, say so and suggest
starting fresh with a one-line brief.

## Verifying

Do not skip verification to save tokens — a wrong "it works" costs far more than
the check. But verify cheaply, and be careful that the test itself is sound:

- `inline_shapes` in python-docx does **not** count floating/anchored images.
  Count `<a:blip>` in `word/document.xml` instead.
- PyMuPDF's text extraction merges and reorders spans; a missing space in
  extracted text is usually the extractor, not the PDF. Measure span positions
  before believing it.
- PyMuPDF `insert_text` does not wrap. A synthetic fixture may not contain what
  you think it does — check the fixture before blaming the code.
- Confirm a regression against the previous commit (`git checkout <ref> -- path`)
  before attributing it to a recent change.

## Environment

- `npm run dev` serves on :8080. Restart it after touching `vite.config.ts` or a
  vite plugin. A `pkill -f vite` often returns exit 144 — harmless, just sleep and
  retry.
- Playwright is not a saved dependency: `npm i -D playwright --no-save` when
  needed, and run driver scripts from the repo root (not `/tmp`) so the import
  resolves. Chromium is at `/opt/pw-browsers/chromium`.
- LibreOffice here has **Writer only** — no Calc or Impress, so it cannot open
  `.xlsx` or `.pptx`. Verify those against the fixture source instead.
- `ilovepdf.com` and `jsdelivr` are blocked by the egress proxy. npm is not, so
  fetch assets as packages rather than over HTTP.

## Architecture

Everything runs in the browser. There is no server-side conversion left except
fetching a URL for HTML → PDF, which the same-origin policy makes impossible in
a tab. Do not reintroduce a service dependency.

- `src/lib/office/` — shared Office engine: one document model, one layout pass,
  one PDF emitter, plus OOXML zip/XML read and write. Format-specific extractors
  sit on top (`word-to-pdf/`, `excel-to-pdf/`, `ppt-to-pdf/`) and only produce
  that model.
- `src/lib/pdf-to-word/` — reading a PDF into geometry, columns, paragraphs and
  tables. `read.ts` drives it, and all three "from PDF" conversions share it;
  they differ only in what they write.
- Invisible text layers (HTML → PDF, Redact, OCR) all reuse
  `src/lib/html-to-pdf/unicode-font.ts` — a carrier font whose ToUnicode map is
  the identity, so any script stays searchable. Reuse it rather than writing
  another.
- Anything that must genuinely remove content (Redact) rebuilds the page as a
  picture. Drawing over text hides nothing.

## Known gap

PDF → Word on a designed CV: with the sidebar no longer flattened to a picture
(commit 7d33ed4), its text shares lines with the main column and reads
interleaved. The column gutter is rejected by a body-copy heuristic that ragged
sidebar labels cannot pass. Fixing it needs the layout pass to know where the
page's shaded bands are — `page.fills` was empty for the file tested, so find out
where those fills go before building on them.
