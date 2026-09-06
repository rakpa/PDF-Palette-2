import "../promise-with-resolvers-polyfill";
import type { PDFPageProxy } from "pdfjs-dist";
import { createImageRasterCache, extractPage, renderPageBitmap } from "../pdf-to-word/pdf-extract";
import { layoutForPage, openPdf, pdfjsLib } from "../pdf-to-word/read";
import { PdfToWordError } from "../pdf-to-word-browser";
import type { PageContent } from "../pdf-to-word/types";
import { writeFidelityDocument, type FidelityPage, type HiddenTextLine } from "./emit";
import { recogniseScannedPage } from "./ocr-layer";
import { createSampler, type PaintedFill } from "./sample";

/** A painted cover is reproduced as the page itself, not reconstructed. */
const COVER_SPARSE_CHARS = 40;
const COVER_MAX_CHARS = 800;

function looksLikeCover(content: PageContent): boolean {
  if (content.pageNumber !== 1) return false;
  const pictures = content.images.length + content.artwork.length;
  if (content.textChars <= COVER_SPARSE_CHARS) return true;
  return pictures >= 1 && content.textChars <= COVER_MAX_CHARS;
}

function hiddenFromContent(content: PageContent): HiddenTextLine[] {
  return content.lines
    .map((line) => ({
      text: line.spans.map((span) => span.text).join(""),
      x: line.x,
      y: line.yTop,
      width: Math.max(6, line.xEnd - line.x),
      height: Math.max(6, line.yBottom - line.yTop),
    }))
    .filter((line) => line.text.trim().length > 0);
}

/**
 * PDF → Word, reproduced rather than reflowed.
 *
 * The reading half is the one the other "from PDF" conversions use: geometry,
 * columns, paragraphs and tables come out of `pdf-to-word/read`. What differs
 * is the writing: `emit.ts` pins every block to the coordinates it was read
 * at instead of handing the document to Word's paragraph flow. Nothing is
 * uploaded — the whole conversion happens in the tab.
 */

export type ConversionProgress = (progress: number, message?: string) => void;

/** A page the layout engine could not read is still reproduced as a picture. */
async function pageAsPicture(
  page: PDFPageProxy,
  pageNumber: number
): Promise<FidelityPage | null> {
  const viewport = page.getViewport({ scale: 1 });
  const pageImage = await renderPageBitmap(page, viewport.width, viewport.height);
  if (!pageImage) return null;
  const content: PageContent = {
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    lines: [],
    images: [],
    rules: [],
    fills: [],
    shadings: [],
    artwork: [],
    textChars: 0,
  };
  return {
    content,
    pageImage,
    layout: {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      contentTop: 0,
      headerDistance: 0,
      footerDistance: 0,
      header: [],
      footer: [],
      body: [],
      scanned: true,
    },
    hidden: await recogniseScannedPage(page).catch(() => []),
  };
}

export async function convertPdfToWordFidelity(
  file: File,
  onProgress?: ConversionProgress
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(3, "Reading PDF…");
  const buffer = await file.arrayBuffer();
  const { pdf, release } = await openPdf(buffer);
  if (pdf.numPages === 0) {
    await release();
    throw new PdfToWordError("This PDF has no pages.", "empty");
  }

  const pages: FidelityPage[] = [];
  const rasterCache = createImageRasterCache();

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress?.(
        5 + (pageNumber / pdf.numPages) * 78,
        `Rebuilding page ${pageNumber} of ${pdf.numPages}…`
      );
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await extractPage(page, pdfjsLib, pageNumber, rasterCache);
        const layout = layoutForPage(content);
        if (looksLikeCover(content)) {
          const pageImage = await renderPageBitmap(page, content.width, content.height);
          if (pageImage) {
            pages.push({
              layout: {
                ...layout,
                scanned: true,
                body: [],
                header: [],
                footer: [],
              },
              content,
              pageImage,
              hidden: hiddenFromContent(content),
            });
            continue;
          }
        }
        if (layout.scanned) {
          onProgress?.(
            5 + (pageNumber / pdf.numPages) * 78,
            `Recognising page ${pageNumber} of ${pdf.numPages}…`
          );
          pages.push({
            layout,
            content,
            pageImage: await renderPageBitmap(page, content.width, content.height),
            hidden: await recogniseScannedPage(page).catch(() => []),
          });
        } else {
          // A pattern or a shading is named in the content stream, not
          // coloured, so its colour has to be read off the rendered page.
          const painted = [...content.fills, ...content.shadings];
          // Every page is sampled, not only the ones the scanner found paint
          // on: a panel it missed entirely is exactly what the sweep is for.
          const sample = await createSampler(page, content.width, content.height);
          let fills: PaintedFill[] | undefined;
          if (sample) {
            fills = painted.map((fill) => sample.read(fill.rect, fill.color));
            // Anything else already accounted for on the page, so the sweep
            // only reports paint that would otherwise be lost.
            const covered = [
              ...fills.map((f) => f.rect),
              ...content.images.map((i) => i.rect),
              ...content.artwork.map((a) => a.rect),
            ];
            fills = [...sample.sweep(covered), ...fills];
          }
          const rules = sample
            ? content.rules.map((rule) => {
                const thickness = Math.max(0.4, rule.thickness);
                const rect = rule.horizontal
                  ? {
                      x0: rule.start,
                      y0: rule.pos - thickness / 2,
                      x1: rule.end,
                      y1: rule.pos + thickness / 2,
                    }
                  : {
                      x0: rule.pos - thickness / 2,
                      y0: rule.start,
                      x1: rule.pos + thickness / 2,
                      y1: rule.end,
                    };
                const read = sample.read(rect, rule.color ?? "000000");
                // A hairline can fall between sample points and read as the
                // paper behind it; the scanner's own colour is better then.
                return /^F[0-9A-F]F[0-9A-F]F[0-9A-F]$/.test(read.color)
                  ? rule
                  : { ...rule, color: read.color };
              })
            : undefined;
          pages.push({ layout, content, pageImage: null, fills, rules });
        }
      } catch (error) {
        console.warn(`pdf-to-word: page ${pageNumber} could not be rebuilt`, error);
        const fallback = await pageAsPicture(page, pageNumber).catch(() => null);
        if (fallback) pages.push(fallback);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await release();
  }

  if (pages.length === 0) {
    throw new PdfToWordError("No page of this PDF could be read.", "empty");
  }

  onProgress?.(88, "Building Word document…");
  const bytes = await writeFidelityDocument(pages);
  onProgress?.(100, "Done");

  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: new Blob([bytes as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    filename: `${base}.docx`,
  };
}
