# Word to PDF — Simple Setup

## What you need

1. **LibreOffice** — for Word → PDF ([libreoffice.org](https://www.libreoffice.org/))
2. **Python 3.10+** — for PDF → Word layout reconstruction
3. **Node.js**

No Redis, no Docker, no cloud APIs.

---

## First time only

```powershell
cd C:\RAKESH\pdf-palette
npm run setup
```

This installs Node packages **and** Python packages (`pdf2docx`, `PyMuPDF`, etc.).

If `pip` fails, install Python from [python.org](https://www.python.org/downloads/) and check **“Add Python to PATH”**, then run:

```powershell
npm run setup:python
```

---

## Every time you use the app

```powershell
cd C:\RAKESH\pdf-palette
npm run dev
```

- **Word → PDF:** http://localhost:8080/word-to-pdf (LibreOffice)
- **PDF → Word:** http://localhost:8080/pdf-to-word (pdf2docx — layout, images, tables, code)

---

## PDF → Word engine

Uses **pdf2docx** locally to reconstruct:

- Page layout, margins, spacing, page breaks  
- Embedded images at original resolution  
- Tables as editable Word tables  
- Fonts and colors where available in the PDF  
- Monospace / code blocks (Consolas + preserved indentation)  
- OCR pass for scanned PDFs (if `ocrmypdf` + Tesseract are installed)

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
