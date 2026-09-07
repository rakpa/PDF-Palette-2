import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const FONT_SIZE = 12;
const LINE_HEIGHT = 16;

/**
 * Turn a plain-text file into a simple multi-page PDF.
 */
export async function txtToPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(8, "Reading text…");
  const text = await file.text();
  if (!text.trim()) {
    throw new Error("This text file is empty.");
  }

  onProgress?.(20, "Laying out pages…");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  const paragraphs = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, FONT_SIZE) <= maxWidth) {
        current = next;
      } else {
        if (current) lines.push(current);
        // Hard-break an oversized single token.
        if (font.widthOfTextAtSize(word, FONT_SIZE) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            const trial = chunk + ch;
            if (font.widthOfTextAtSize(trial, FONT_SIZE) <= maxWidth) chunk = trial;
            else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
  }

  const linesPerPage = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const slice = lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage);
    let y = PAGE_HEIGHT - MARGIN - FONT_SIZE;
    for (const line of slice) {
      if (line) {
        page.drawText(line, {
          x: MARGIN,
          y,
          size: FONT_SIZE,
          font,
          color: rgb(0.1, 0.1, 0.12),
        });
      }
      y -= LINE_HEIGHT;
    }
    onProgress?.(
      25 + Math.round(((pageIndex + 1) / pageCount) * 70),
      `Page ${pageIndex + 1} of ${pageCount}…`
    );
  }

  onProgress?.(98, "Saving…");
  const saved = await pdf.save();
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.(txt|text|md)$/i, "") || "document";
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}.pdf`,
  };
}
