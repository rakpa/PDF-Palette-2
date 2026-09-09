import { PDFDocument, rgb } from "pdf-lib";
import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  {
    name: "phone",
    re: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{4}\b/g,
  },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    name: "card",
    re: /\b(?:\d[ -]*?){13,19}\b/g,
  },
  { name: "ip", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

type Hit = { page: number; x: number; y: number; w: number; h: number };

/**
 * Find common PII patterns in text and black them out, then flatten pages
 * so the underlying text cannot be selected.
 */
export async function autoRedactPiiLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string; redactionCount: number }> {
  onProgress?.(5, "Opening PDF…");
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjsLib.getDocument({
    data: data.slice(),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let src;
  try {
    src = await task.promise;
  } catch {
    void task.destroy().catch(() => undefined);
    throw new Error("This file could not be read as a PDF.");
  }

  const hits: Hit[] = [];
  try {
    const total = src.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await src.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const str = String(item.str);
        const transform = item.transform as number[];
        const fontHeight = Math.abs(transform[3] || transform[0] || 10);
        const x0 = transform[4];
        const y0 = transform[5];
        for (const { re } of PATTERNS) {
          re.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = re.exec(str))) {
            const start = match.index;
            const matched = match[0];
            // Approximate glyph width from full item width.
            const itemWidth =
              typeof item.width === "number" && item.width > 0
                ? item.width
                : fontHeight * 0.5 * str.length;
            const unit = str.length ? itemWidth / str.length : fontHeight * 0.5;
            const x = x0 + start * unit;
            const w = Math.max(unit * matched.length, fontHeight);
            hits.push({
              page: n,
              x,
              y: y0 - fontHeight * 0.15,
              w,
              h: fontHeight * 1.2,
            });
          }
        }
      }
      void viewport;
      page.cleanup();
      onProgress?.(8 + Math.round((n / total) * 40), `Scanning page ${n} of ${total}…`);
    }
  } finally {
    await src.destroy().catch(() => undefined);
    void task.destroy().catch(() => undefined);
  }

  if (hits.length === 0) {
    throw new Error("No email, phone, SSN, card, or IP patterns were found to redact.");
  }

  onProgress?.(55, "Applying redactions…");
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(data);
  } catch {
    throw new Error("This file could not be read as a PDF.");
  }

  const pages = pdf.getPages();
  for (const hit of hits) {
    const page = pages[hit.page - 1];
    if (!page) continue;
    page.drawRectangle({
      x: hit.x,
      y: hit.y,
      width: hit.w,
      height: hit.h,
      color: rgb(0, 0, 0),
      borderWidth: 0,
    });
  }

  // Rasterize so underlying text cannot be copied (same idea as Redact tool).
  onProgress?.(70, "Locking redacted pages…");
  const intermediate = await pdf.save();
  const { flattenPdfLocal } = await import("./flatten-pdf");
  const flattened = await flattenPdfLocal(
    new File([new Uint8Array(intermediate)], file.name, { type: "application/pdf" }),
    (p, message) => onProgress?.(70 + Math.round(p * 0.28), message)
  );

  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: flattened.blob,
    filename: `${base}-redacted.pdf`,
    redactionCount: hits.length,
  };
}
