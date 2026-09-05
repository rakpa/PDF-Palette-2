# PDF Palette — Simple Setup

## What you need

1. **Node.js**
2. **Adobe PDF Services credentials** — for PDF → Word and Word → PDF.
   Copy `services/word-to-pdf/.env.example` to `services/word-to-pdf/.env`
   and set `PDF_SERVICES_CLIENT_ID` and `PDF_SERVICES_CLIENT_SECRET`.
   On Vercel, set the same two variables on the project (or the `adobe` service).

LibreOffice is optional (Word → PDF falls back to it if Adobe is not configured).

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

- **Word → PDF:** http://localhost:8080/word-to-pdf (Adobe PDF Services)
- **PDF → Word:** http://localhost:8080/pdf-to-word (Adobe PDF Services)
- **Edit PDF:** http://localhost:8080/edit-pdf (in-browser, no setup)
- **Sign PDF:** http://localhost:8080/sign-pdf (in-browser, no setup)
- **Protect / Unlock PDF:** http://localhost:8080/protect-pdf, `/unlock-pdf`
  (in-browser, no setup)
- **HTML → PDF:** http://localhost:8080/html-to-pdf — uploading a file needs no
  setup; the URL field asks the local service to fetch the page

---

## PDF → Word and Word → PDF

Both tools call Adobe PDF Services through the serverless functions in
`api/adobe/` (`/api/adobe/asset`, `/job`, `/status`, `/health`) — the same
handlers in production and under `npm run dev`. The browser never sees the
client secret; it only receives the short-lived presigned Adobe URLs.

Set these on the deployment (Vercel → Settings → Environment Variables) or in a
local `.env.local`, taking the values from `pdfservices-api-credentials.json`:

```
PDF_SERVICES_CLIENT_ID=<client_credentials.client_id>
PDF_SERVICES_CLIENT_SECRET=<client_credentials.client_secret>
```

Check they arrived with `curl https://<your-app>/api/adobe/health` — it reports
`"checks": { "adobe": true }` when the credentials are readable.

If the service is down, the in-browser engines in `src/lib/pdf-to-word/`
and `src/lib/word-to-pdf/` are used as a fallback.

The in-browser PDF → Word fallback reconstructs:

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

## Edit PDF and Sign PDF

Both run entirely in the browser on `src/lib/pdf-editor/`. Pages are rendered
with `pdfjs-dist`; whatever you place is flattened back onto the *original*
pages with `pdf-lib`, so the existing content is copied through untouched
rather than rebuilt.

**Edit PDF** adds text (in real, selectable PDF fonts), images, rectangles,
ellipses, lines, arrows, freehand ink, highlights that let the text below show
through, and an eraser block for covering something up before typing over it.
Pages can be rotated, duplicated, reordered and deleted, and everything is
undoable.

**Sign PDF** is the same surface with a signature-first toolset: draw a
signature with a mouse or finger, type one in a choice of faces, or upload a
photo of one — the paper behind an uploaded photo is removed automatically.
Signatures are held in memory for the tab only and are never written to disk,
so nothing is left behind on a shared computer.

Anything placed lands where you put it on any page, including pages the file
stores rotated: positions are recorded in the space you are looking at and
mapped back through the page's own transform on save.

---

## Password protection

Protect PDF and Unlock PDF do the cryptography themselves, in the tab, on
`src/lib/pdf-crypto/`. There is no qpdf, no service and no upload: the file is
parsed with `pdf-lib`, and every string and stream is encrypted or decrypted
with the PDF standard security handler built on Web Crypto.

Protecting a file writes revision 6 — AES-256 with the SHA-2 hardened key
derivation — which is what current readers expect. Unlocking accepts anything
back to revision 2, so RC4-40, RC4-128, AES-128 and AES-256 all open given the
password. A wrong password is reported as one rather than producing a damaged
file.

---

## HTML → PDF

An uploaded HTML file never leaves the tab. It is laid out in a sandboxed frame
that cannot run scripts, captured page by page through the browser's own
renderer, and paired with an invisible text layer read back from the live DOM —
so the PDF looks exactly like the page *and* its text can still be selected,
searched and copied, in any script the page uses. Page breaks respect
`break-before: page` and never slice a line of text in half.

The **URL** field is the one thing that still needs the local service: the
same-origin policy stops a tab from reading another site's HTML, so the page
has to be fetched and rendered outside the browser.

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
| HTML → PDF | http://localhost:8080/html-to-pdf |
