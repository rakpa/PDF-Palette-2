import "../promise-with-resolvers-polyfill";
import type { PDFPageProxy } from "pdfjs-dist";
import { createImageRasterCache, extractPage, renderPageBitmap } from "../pdf-to-word/pdf-extract";
import { layoutForPage, openPdf, pdfjsLib } from "../pdf-to-word/read";
import { PdfToWordError } from "../pdf-to-word-browser";
import type { PageContent } from "../pdf-to-word/types";
import { writeFidelityDocument, type FidelityPage } from "./emit";
import { recogniseScannedPage } from "./ocr-layer";

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
          pages.push({ layout, content, pageImage: null });
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
