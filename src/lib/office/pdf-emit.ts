import { rgb, type PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import type { FontSet } from "./fonts";
import { pickFont } from "./fonts";
import type { PlacedPage } from "./types";

function color(hex: string | undefined) {
  const value = (hex ?? "000000").replace("#", "").padStart(6, "0");
  const n = Number.parseInt(value.slice(0, 6), 16);
  if (!Number.isFinite(n)) return rgb(0, 0, 0);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function flip(pageHeight: number, y: number): number {
  return pageHeight - y;
}

async function embedImage(pdf: PDFDocument, cache: Map<Uint8Array, PDFImage>, data: Uint8Array, type: "png" | "jpg"): Promise<PDFImage | undefined> {
  const hit = cache.get(data);
  if (hit) return hit;
  try {
    const image = type === "png" ? await pdf.embedPng(data) : await pdf.embedJpg(data);
    cache.set(data, image);
    return image;
  } catch {
    return undefined;
  }
}

function paintPage(pdfPage: PDFPage, page: PlacedPage, fonts: FontSet, images: Map<Uint8Array, PDFImage>): void {
  const h = page.height;

  for (const rect of page.rects) {
    pdfPage.drawRectangle({
      x: rect.x,
      y: flip(h, rect.y + rect.height),
      width: Math.max(0.1, rect.width),
      height: Math.max(0.1, rect.height),
      color: rect.fill ? color(rect.fill) : undefined,
      borderColor: rect.stroke ? color(rect.stroke) : undefined,
      borderWidth: rect.strokeWidth ?? 0,
    });
  }

  for (const rule of page.rules) {
    pdfPage.drawLine({
      start: { x: rule.x1, y: flip(h, rule.y1) },
      end: { x: rule.x2, y: flip(h, rule.y2) },
      thickness: Math.max(0.2, rule.thickness),
      color: color(rule.color),
    });
  }

  for (const span of page.spans) {
    if (!span.text) continue;
    const font = pickFont(fonts, span.style);
    try {
      pdfPage.drawText(span.text, {
        x: span.x,
        y: flip(h, span.baseline),
        size: Math.max(1, span.fontSize),
        font,
        color: color(span.style.color),
      });
    } catch {
      // A character StandardFonts cannot encode was missed by the layout sanitizer.
    }
  }
}

export async function emitPdf(pdf: PDFDocument, fonts: FontSet, pages: PlacedPage[]): Promise<void> {
  const cache = new Map<Uint8Array, PDFImage>();
  for (const page of pages) {
    const pdfPage = pdf.addPage([page.width, page.height]);
    for (const image of page.images) {
      const embedded = await embedImage(pdf, cache, image.data, image.type);
      if (!embedded) continue;
      pdfPage.drawImage(embedded, {
        x: image.x,
        y: flip(page.height, image.y + image.height),
        width: image.width,
        height: image.height,
      });
    }
    paintPage(pdfPage, page, fonts, cache);
  }
}
