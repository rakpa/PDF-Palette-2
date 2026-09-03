import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { PdfPagesError } from "./organize";
import { normalizeRotation, visibleSize, visibleToPage } from "./geometry";

export type NumberPosition =
  | "top-left" | "top-center" | "top-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type NumberFace = "sans" | "serif" | "mono";

export interface PageNumberOptions {
  position: NumberPosition;
  /** Template with {n} for the page number and {N} for the total. */
  format: string;
  /** The number printed on the first numbered page. */
  startAt: number;
  /** One-based, inclusive. Pages outside the range are left alone. */
  fromPage: number;
  toPage: number;
  fontSize: number;
  /** Distance from the edge of the page, in points. */
  margin: number;
  face: NumberFace;
  color: { r: number; g: number; b: number };
}

export const DEFAULT_PAGE_NUMBERS: PageNumberOptions = {
  position: "bottom-center",
  format: "{n}",
  startAt: 1,
  fromPage: 1,
  toPage: 0,
  fontSize: 11,
  margin: 28,
  face: "sans",
  color: { r: 0, g: 0, b: 0 },
};

const FACES: Record<NumberFace, StandardFonts> = {
  sans: StandardFonts.Helvetica,
  serif: StandardFonts.TimesRoman,
  mono: StandardFonts.Courier,
};

/** Drop anything the standard fonts cannot spell, so a stray glyph never fails the job. */
function spellable(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out += char;
  }
  return out;
}

export async function addPageNumbers(
  bytes: Uint8Array,
  options: PageNumberOptions
): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new PdfPagesError("This file could not be read as a PDF.");
  }

  const pages = pdf.getPages();
  const total = pages.length;
  const from = Math.max(1, Math.min(options.fromPage || 1, total));
  const to = options.toPage > 0 ? Math.min(options.toPage, total) : total;
  if (to < from) throw new PdfPagesError("The last page comes before the first page.");

  const font = await pdf.embedFont(FACES[options.face] ?? StandardFonts.Helvetica);
  const size = Math.max(4, Math.min(72, options.fontSize || 11));
  const margin = Math.max(0, options.margin);
  const numbered = to - from + 1;

  const [vertical, horizontal] = options.position.split("-");

  for (let index = from - 1; index < to; index++) {
    const page = pages[index];
    const rotation = normalizeRotation(page.getRotation().angle);
    const { width, height } = page.getSize();
    const visible = visibleSize(width, height, rotation);

    const label = spellable(
      (options.format || "{n}")
        .replace(/\{n\}/g, String(options.startAt + (index - (from - 1))))
        .replace(/\{N\}/g, String(options.startAt + numbered - 1))
    );
    if (!label) continue;

    let textWidth: number;
    try {
      textWidth = font.widthOfTextAtSize(label, size);
    } catch {
      continue;
    }

    // Where the text sits on the page as the reader sees it.
    let x: number;
    if (horizontal === "left") x = margin;
    else if (horizontal === "right") x = visible.width - margin - textWidth;
    else x = (visible.width - textWidth) / 2;

    const y =
      vertical === "top"
        ? visible.height - margin - size * 0.8
        : margin;

    const anchor = visibleToPage(x, y, width, height, rotation);
    page.drawText(label, {
      x: anchor.x,
      y: anchor.y,
      size,
      font,
      rotate: degrees(rotation),
      color: rgb(options.color.r, options.color.g, options.color.b),
    });
  }

  return pdf.save();
}
