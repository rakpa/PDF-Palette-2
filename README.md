# PDF Palette

Free, privacy-first PDF tools that run **entirely in your browser**. No uploads,
no sign-up, no watermarks — your files never leave your device.

## Features

Tools that work fully client-side (powered by [`pdf-lib`](https://pdf-lib.js.org/)):

- **Merge PDF** – combine multiple PDFs into one
- **Split PDF** – extract page ranges or every page
- **Rotate PDF** – turn pages 90° / 180° / 270°
- **Compress PDF** – strip metadata and re-pack object streams
- **Add Watermark** – stamp custom diagonal text on every page
- **JPG to PDF** – turn JPG/PNG images into a PDF
- **PDF to Word** – rebuild a PDF as an editable `.docx`, layout and all
  (`pdfjs-dist` + [`docx`](https://docx.js.org/), see `src/lib/pdf-to-word/`)
- **Edit PDF** – add text, images, shapes, freehand ink, highlights and
  whiteout; rotate, duplicate, reorder and delete pages
- **Sign PDF** – draw, type or upload a signature and place it on the page
- **Protect PDF** – real AES-256 encryption (revision 6), written by our own
  implementation of the PDF standard security handler (`src/lib/pdf-crypto/`)
- **Unlock PDF** – open and strip RC4-40/128, AES-128 and AES-256 encryption
  given the password
- **HTML to PDF** – lay an uploaded HTML file out with the browser's own engine
  and capture it, with a real, searchable text layer (`src/lib/html-to-pdf/`)
- **Organize PDF** – reorder pages by dragging, and rotate, duplicate or delete
  any of them
- **Remove Pages** / **Extract Pages** – pick pages on the page itself, or by
  typing ranges; the two stay in step
- **Add Page Numbers** – position, format, starting number, range and face
- **Crop PDF** – drag a crop box; the content is kept, so it can be widened again
- **PDF to JPG** – render pages to JPG or PNG at up to 300 dpi; more than one
  page comes back as a ZIP
- **Excel to PDF** – every sheet, with its own number formats, fills, borders,
  merged cells and column widths (`src/lib/excel-to-pdf/`)
- **PowerPoint to PDF** – one page per slide at the deck's own size, with its
  text, bullets, pictures, tables, shape fills and theme colours
  (`src/lib/ppt-to-pdf/`)
- **PDF to Excel** – tables recovered into sheets, one per page, with numbers
  arriving as real numbers (`src/lib/pdf-to-excel/`)
- **PDF to PowerPoint** – one slide per page, with editable text boxes,
  pictures and tables where they stood (`src/lib/pdf-to-ppt/`)
- **Fill PDF Forms** – every field a PDF declares, filled in here and optionally
  flattened so the answers can no longer be changed (`src/lib/pdf-forms/`)
- **Redact PDF** – drag over anything, or search for a phrase; the marked
  content is removed from the file rather than covered (`src/lib/pdf-redact/`)
- **Compare PDF** – a word-level diff of two versions plus a per-page visual
  comparison (`src/lib/pdf-compare/`)
- **OCR PDF** – scanned pages recognised in the tab with Tesseract, then given
  an invisible text layer so they can be searched and copied (`src/lib/pdf-ocr/`)

**Word → PDF** uses a small local service that drives LibreOffice, and the
HTML → PDF *URL* field uses it too — a tab cannot read another site's HTML.
Everything else runs in the tab.

The remaining tools are showcased and flagged **“Soon”**.

## Tech stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [framer-motion](https://www.framer.com/motion/) for animation
- [pdf-lib](https://pdf-lib.js.org/) for in-browser PDF processing

## Getting started

```sh
npm install
npm run dev      # start the dev server
npm run build    # production build
npm run lint     # lint the project
```

## SEO

`npm run build` runs `scripts/prerender.mjs` after Vite. It writes a static
`dist/<route>/index.html` for every route — each with its own title,
description, canonical, Open Graph tags and JSON-LD — plus `sitemap.xml`,
`robots.txt` and `404.html`. Vercel serves those static files before the SPA
rewrite, so crawlers get real per-page metadata; `useSeo` in `src/lib/seo.ts`
keeps the head correct once React takes over routing.

Landing-page copy (intro, how-to steps, FAQs) lives in
`src/lib/tool-content.json`, keyed by route, and is rendered by
`ToolSeoContent`. Adding a tool means adding an entry there as well as in
`src/lib/tools.ts`.

Set `SITE_URL` at build time so canonical and Open Graph URLs point at the real
origin. On Vercel, `VERCEL_PROJECT_PRODUCTION_URL` is used automatically.

## Architecture

- `src/lib/tools.ts` – the tool catalog. Each tool declares a `feature`
  (a working pdf-lib engine) or `comingSoon: true`.
- `src/lib/pdf-utils.ts` – the actual PDF operations.
- `src/lib/pdf-to-word/` – reading a PDF: `pdf-extract.ts` reads a page into a
  geometric model, `layout.ts` segments it into columns, paragraphs and blocks,
  `tables.ts` recovers tables, and `read.ts` drives the whole pass. All three
  "from PDF" conversions share it, and differ only in what they write —
  `docx-emit.ts`, `src/lib/pdf-to-excel/` and `src/lib/pdf-to-ppt/`, the last
  two on the package writer in `src/lib/office/ooxml-write.ts`.
- `src/lib/pdf-crypto/` – the PDF standard security handler: `primitives.ts`
  has RC4, MD5, AES and SHA-2 built on Web Crypto, `standard-handler.ts` derives
  file and object keys for revisions 2–6, and `document.ts` walks the file to
  encrypt or decrypt every string and stream.
- `src/lib/html-to-pdf/` – the HTML → PDF engine: `frame.ts` lays the file out
  in a script-free sandbox, `text-layer.ts` reads back where every word landed,
  `paginate.ts` chooses page breaks that never cut a line in half, and
  `render.ts` captures each page and writes the invisible text over it.
- `src/lib/office/` – the shared Office engine: one document model, one layout
  pass and one PDF emitter, plus the OOXML zip and XML readers. Each format has
  its own extractor on top — `src/lib/word-to-pdf/` and `src/lib/excel-to-pdf/`
  — whose only job is to produce that model. Slides are already positioned, so
  `src/lib/ppt-to-pdf/` skips the flow layout and places pages directly.
- `src/lib/pdf-pages/` – page-level operations: `organize.ts` rebuilds a
  document from an ordered plan (which every reorder, remove and extract goes
  through), `page-numbers.ts` and `crop.ts` sit on `geometry.ts`, which maps
  between the page's own space and the one the reader sees on a rotated page.
- `src/lib/pdf-to-image.ts` – renders pages with pdf.js and packs several into
  a ZIP with `src/lib/zip-write.ts`.
- `src/lib/pdf-ocr/` – OCR: each page is rendered, recognised with Tesseract in
  a worker, and an invisible Unicode text layer is written over the original
  page. Worker, WASM cores and English traineddata are shipped next to the app
  the same way Ghostscript is (`vite.tesseract.ts`).
- `src/lib/pdf-editor/` – the editor engine behind Edit PDF and Sign PDF:
  `document.ts` opens and renders pages, `geometry.ts` maps between screen and
  PDF space, `state.ts` holds the document with undo/redo, and `export.ts`
  flattens what was placed back onto the original pages with `pdf-lib`.
- `src/components/pdf-editor/` – the editing surface: toolbar, page canvas,
  annotation handles, properties panel, page rail and signature dialog.
- `src/pages/ToolPage.tsx` – one data-driven page that renders the right
  controls and dispatches to the matching engine, keyed on the route.
- `src/pages/Index.tsx` – the landing page (hero, tool grid, features).
