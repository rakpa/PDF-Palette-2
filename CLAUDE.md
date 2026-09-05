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

## Reporting

Summarise fixes as short bullets — what changed, the number that proves it, what
is still open. No walls of prose, no narration of the steps taken. Detail belongs
in the commit message, where it can be read on demand.

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

Most tools run in the browser. PDF → Word and Word → PDF call CloudConvert
over REST (`POST /v2/jobs` with `import/upload` + `convert` + `export/url`).
They live in `api/convert/*.js` — ordinary Vercel serverless functions, with
the REST client in `api/_lib/cloudconvert.js` — and `vite.convertApi.ts` mounts
the same handlers on the dev server, so `/api/convert/*` means the same thing
everywhere. Keep `CLOUDCONVERT_API_KEY` on the server — never a `VITE_` env var.

Converted DOCX gets one repair on the way out (`docx-rules.ts`): a rule under a
chapter title comes back as a floating shape at a fixed offset, and the
`wrapNone` variant floats over the text once Word re-breaks the lines — a struck-
through table of contents. They are switched to `wrapTopAndBottom`. Hairlines
only, and it returns the file untouched on any error.

The browser drives the job: it asks for an upload form, POSTs the file
straight to CloudConvert (past the 4.5 MB request-body limit), then polls
`/api/convert/status` itself. Never poll CloudConvert *inside* a function — the
wait outlives the platform's execution limit and surfaces as an opaque HTTP 500.
HTML → PDF from a URL still needs the same service. Do not reintroduce further
service dependencies.

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
- `src/lib/compress-args.ts` holds the whole Ghostscript command line, kept out
  of the worker so it can be exercised under Node
  (`node --experimental-strip-types`, feeding the args to `assets/gs.js` with a
  `wasmBinary`). Two traps live there: the `/screen` and `/ebook` presets set
  `ColorConversionStrategy=/sRGB`, which is ~4× slower than
  `/LeaveColorUnchanged` and turns a 1-bit scan into an RGB image; and
  `CompatibilityLevel=1.4` makes Ghostscript flatten transparency. Ghostscript
  exits 0 on an encrypted or damaged file after writing a ~3 KB stub, so the
  worker counts its `Page N` stdout lines against `Processing pages 1 through N`
  rather than trusting the exit code — those same lines drive the progress bar.

## Known gap

None open on PDF → Word's column handling. A designed CV's sidebar now splits
from the main column on the evidence of its shaded band (`page.fills`), which
`splitAtGutters` accepts in place of the body-copy test that ragged sidebar
labels cannot pass.
