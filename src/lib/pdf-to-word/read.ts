import "../promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  createImageRasterCache,
  extractPage,
  renderPageBitmap,
  type ImageRasterCache,
} from "./pdf-extract";
import { buildPageLayout, fitToPage, isScannedPage, type Box, type PageLayout } from "./layout";
import { createTableSplitter } from "./tables";
import type { PageContent, PdfImage, PdfLine } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export { pdfjsLib, createImageRasterCache, renderPageBitmap, fitToPage };
export type { ImageRasterCache, PageLayout, PdfImage };

export class PdfReadError extends Error {
  constructor(
    message: string,
    readonly code: "password" | "corrupt" | "empty" | "failed"
  ) {
    super(message);
    this.name = "PdfReadError";
  }
}

/**
 * Build the document tree for one page. Table detection and paragraph building
 * are mutually recursive (cells contain paragraphs, and a cell may itself hold
 * a nested table), so the builders are wired together here.
 */
export function layoutForPage(page: PageContent): PageLayout {
  const buildCellContent = (lines: PdfLine[]): Box[] => {
    if (lines.length === 0) return [];
    const cellPage: PageContent = { ...page, lines, images: [], artwork: [] };
    // Cells hold plain blocks: no header/footer split and no nested detection,
    // which keeps a stray aligned pair inside a cell from spawning a table.
    const cellLayout = buildPageLayout(cellPage, (cellLines) => [cellLines], { scanned: false });
    return cellLayout.body;
  };

  return buildPageLayout(page, createTableSplitter(page, buildCellContent), {
    scanned: isScannedPage(page),
  });
}

export async function layoutPage(
  page: PDFPageProxy,
  pageNumber: number,
  rasterCache: ImageRasterCache
): Promise<{ layout: PageLayout; pageImage: PdfImage | null }> {
  const content = await extractPage(page, pdfjsLib, pageNumber, rasterCache);
  const layout = layoutForPage(content);
  const pageImage = layout.scanned
    ? await renderPageBitmap(page, content.width, content.height)
    : null;
  return { layout, pageImage };
}

export type LoadedPdf = { pdf: PDFDocumentProxy; release: () => Promise<void> };

export async function openPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(data.slice(0)),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  try {
    const pdf = await task.promise;
    return { pdf, release: () => task.destroy().catch(() => undefined) };
  } catch (error) {
    await task.destroy().catch(() => undefined);
    const name = (error as { name?: string })?.name ?? "";
    const message = (error as Error)?.message ?? "";
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new PdfReadError(
        "This PDF is password-protected. Unlock it first, then convert it.",
        "password"
      );
    }
    if (name === "InvalidPDFException" || /invalid|corrupt/i.test(message)) {
      throw new PdfReadError("This file is not a readable PDF.", "corrupt");
    }
    throw new PdfReadError(message || "The PDF could not be opened.", "failed");
  }
}

/**
 * Read every page of a PDF into laid-out boxes.
 *
 * A page the layout engine cannot handle is skipped rather than failing the
 * whole document; callers that can fall back to a picture of the page do that
 * themselves, since what a picture means differs by output format.
 */
export async function readPdfLayouts(
  buffer: ArrayBuffer,
  onProgress?: (progress: number, message?: string) => void,
  onPageFailure?: (page: PDFPageProxy, pageNumber: number) => Promise<void>
): Promise<Array<{ layout: PageLayout; pageImage: PdfImage | null }>> {
  const { pdf, release } = await openPdf(buffer);
  if (pdf.numPages === 0) {
    await release();
    throw new PdfReadError("This PDF has no pages.", "empty");
  }

  const out: Array<{ layout: PageLayout; pageImage: PdfImage | null }> = [];
  const rasterCache = createImageRasterCache();

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress?.(
        6 + (pageNumber / pdf.numPages) * 80,
        `Reading page ${pageNumber} of ${pdf.numPages}…`
      );
      const page = await pdf.getPage(pageNumber);
      try {
        out.push(await layoutPage(page, pageNumber, rasterCache));
      } catch (error) {
        console.warn(`pdf: page ${pageNumber} could not be laid out`, error);
        await onPageFailure?.(page, pageNumber);
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await release();
  }

  return out;
}
