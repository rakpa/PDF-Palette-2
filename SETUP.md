# PDF Palette — Simple Setup

## What you need

1. **Node.js**
2. **LibreOffice** — for Word → PDF only ([libreoffice.org](https://www.libreoffice.org/))

No Python, no Redis, no Docker, no cloud APIs.

---

## First time only

```powershell
cd C:\RAKESH\pdf-palette
npm run setup
```

---

## Every time you use the app

```powershell
cd C:\RAKESH\pdf-palette
npm run dev
```

- **Word → PDF:** http://localhost:8080/word-to-pdf (LibreOffice)
- **PDF → Word:** http://localhost:8080/pdf-to-word (in-browser, no setup)

---

## PDF → Word engine

PDF → Word is built entirely from our own code and runs in the browser, so the
file never leaves the machine and development behaves exactly like production.
`pdfjs-dist` reads the page and [`docx`](https://docx.js.org/) writes the
result; everything between the two lives in `src/lib/pdf-to-word/`.

It reconstructs:

- Page size, orientation, margins and page breaks — one Word section per page
- Running headers and footers, as real Word headers and footers
- Paragraphs, with alignment, indents, first-line and hanging indents,
  line spacing and the space between blocks
- Fonts, sizes, bold, italic, underline, strikethrough, colour, superscript
  and subscript, plus hyperlinks
- Tables, both ruled and borderless, with merged cells, cell shading, borders,
  column alignment and row heights
- Multi-column pages, kept side by side and in reading order
- Images at their original resolution and position
- Charts and other vector artwork, rasterised in place
- Scanned pages, kept as a full-page picture

Pages whose text runs sideways are turned upright so the text stays editable,
and a page the layout engine cannot handle falls back to a picture of itself
rather than being dropped.

---

## Vercel

In the project **Build and Deployment** settings, set Framework to **Services**. New Vercel projects reject `experimentalServices`; this repo uses the `services` key in `vercel.json` instead.

---

## Quick reference

| Step | Command |
|------|---------|
| First time | `npm run setup` |
| Start app | `npm run dev` |
| Word → PDF | http://localhost:8080/word-to-pdf |
| PDF → Word | http://localhost:8080/pdf-to-word |
