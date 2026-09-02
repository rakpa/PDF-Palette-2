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

Conversion, OCR, e-signature and password tools are showcased and flagged
**“Soon”** — they require secure server-side processing that isn't wired up yet.
(We deliberately never hand back an unencrypted file dressed up as “protected”.)

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

## Architecture

- `src/lib/tools.ts` – the tool catalog. Each tool declares a `feature`
  (a working pdf-lib engine) or `comingSoon: true`.
- `src/lib/pdf-utils.ts` – the actual PDF operations.
- `src/lib/pdf-to-word/` – the PDF → Word engine: `pdf-extract.ts` reads a page
  into a geometric model, `layout.ts` segments it into columns, paragraphs and
  blocks, `tables.ts` recovers tables, and `docx-emit.ts` writes the document.
- `src/lib/pdf-editor/` – the editor engine behind Edit PDF and Sign PDF:
  `document.ts` opens and renders pages, `geometry.ts` maps between screen and
  PDF space, `state.ts` holds the document with undo/redo, and `export.ts`
  flattens what was placed back onto the original pages with `pdf-lib`.
- `src/components/pdf-editor/` – the editing surface: toolbar, page canvas,
  annotation handles, properties panel, page rail and signature dialog.
- `src/pages/ToolPage.tsx` – one data-driven page that renders the right
  controls and dispatches to the matching engine, keyed on the route.
- `src/pages/Index.tsx` – the landing page (hero, tool grid, features).
