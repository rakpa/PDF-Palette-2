import { PDFDocument } from "pdf-lib";
import { PdfPagesError } from "./organize";
import { normalizeRotation, visibleSize, visibleToPage } from "./geometry";

/**
 * How much to trim from each edge, as a fraction of the page the reader sees.
 * Fractions rather than points, so one crop applies sensibly to a document
 * whose pages are not all the same size.
 */
export interface CropInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_CROP: CropInsets = { left: 0, right: 0, top: 0, bottom: 0 };

export interface CropOptions {
  insets: CropInsets;
  /** One-based and inclusive; 0 for `toPage` means "to the end". */
  fromPage: number;
  toPage: number;
}

/**
 * Crop by setting each page's CropBox.
 *
 * The content is left exactly as it was — cropping a PDF is a change to what
 * the viewer shows, not to what the page contains, which is why the operation
 * is lossless and can be undone by widening the box again.
 */
export async function cropPages(bytes: Uint8Array, options: CropOptions): Promise<Uint8Array> {
  const { left, right, top, bottom } = options.insets;
  if (left + right >= 0.95 || top + bottom >= 0.95) {
    throw new PdfPagesError("That crop would leave almost nothing of the page.");
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw new PdfPagesError("This file could not be read as a PDF.");
  }

  const pages = pdf.getPages();
  const from = Math.max(1, Math.min(options.fromPage || 1, pages.length));
  const to = options.toPage > 0 ? Math.min(options.toPage, pages.length) : pages.length;
  if (to < from) throw new PdfPagesError("The last page comes before the first page.");

  for (let index = from - 1; index < to; index++) {
    const page = pages[index];
    const box = page.getMediaBox();
    const rotation = normalizeRotation(page.getRotation().angle);
    const visible = visibleSize(box.width, box.height, rotation);

    const x0 = left * visible.width;
    const x1 = visible.width - right * visible.width;
    const y0 = bottom * visible.height;
    const y1 = visible.height - top * visible.height;

    // Two opposite corners are enough: rotation maps the rectangle onto
    // another rectangle, so the extremes of the pair bound it.
    const a = visibleToPage(x0, y0, box.width, box.height, rotation);
    const b = visibleToPage(x1, y1, box.width, box.height, rotation);

    const cropX = box.x + Math.min(a.x, b.x);
    const cropY = box.y + Math.min(a.y, b.y);
    const cropW = Math.abs(b.x - a.x);
    const cropH = Math.abs(b.y - a.y);
    if (cropW < 1 || cropH < 1) continue;

    page.setCropBox(cropX, cropY, cropW, cropH);
  }

  return pdf.save();
}
