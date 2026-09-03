import type { PDFPageProxy } from "pdfjs-dist";
import {
  PdfReadError,
  createImageRasterCache,
  fitToPage,
  layoutPage,
  openPdf,
  renderPageBitmap,
} from "./pdf-to-word/read";
import type { Box, PageLayout } from "./pdf-to-word/layout";
import { writeDocument } from "./pdf-to-word/docx-emit";
import type { PdfImage } from "./pdf-to-word/types";

export class PdfToWordError extends Error {
  constructor(
    message: string,
    readonly code: "password" | "corrupt" | "empty" | "failed"
  ) {
    super(message);
    this.name = "PdfToWordError";
  }
}

export type ConversionProgress = (progress: number, message?: string) => void;

function unifyMargins(layouts: PageLayout[]): void {
  const groups = new Map<string, PageLayout[]>();
  for (const layout of layouts) {
    if (layout.scanned) continue;
    const key = `${Math.round(layout.width)}x${Math.round(layout.height)}`;
    const group = groups.get(key);
    if (group) group.push(layout);
    else groups.set(key, [layout]);
  }

  for (const group of groups.values()) {
    const height = group[0].height;
    const footerDistance = Math.max(...group.map((l) => l.footerDistance));
    const bottom = Math.min(...group.map((l) => l.margins.bottom));
    // Word re-wraps paragraphs with its own font metrics, so a page whose text
    // exactly filled the original measure can end up one line too long. Give
    // every page a little headroom above the footer; nothing moves, because
    // content is positioned from the top of the page.
    const slack = Math.min(bottom, height * 0.06);
    const margins = {
      top: Math.min(...group.map((l) => l.margins.top)),
      right: Math.min(...group.map((l) => l.margins.right)),
      bottom: Math.max(Math.min(18, bottom), Math.max(bottom - slack, footerDistance + 6)),
      left: Math.min(...group.map((l) => l.margins.left)),
    };
    for (const layout of group) {
      const drop = Math.max(0, layout.contentTop - margins.top);
      layout.margins = { ...margins };
      const first = layout.body.find(
        (box): box is Exclude<Box, { kind: "spacer" }> => box.kind !== "spacer"
      );
      if (drop > 1 && first) {
        first.spaceBefore += drop;
      }
      fitToPage(layout);
    }
  }
}

/** Last resort for a page the layout engine cannot handle: a picture of it. */
async function fallbackPage(
  page: PDFPageProxy,
  pageNumber: number
): Promise<{ layout: PageLayout; pageImage: PdfImage | null }> {
  const viewport = page.getViewport({ scale: 1 });
  const image = await renderPageBitmap(page, viewport.width, viewport.height);
  return {
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
    pageImage: image,
  };
}

function yieldUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Rebuild a PDF as a Word document in the browser.
 *
 * Same shape as Word → PDF: extract, lay out, then emit with the Office
 * package writer. The file never leaves the machine.
 */
export async function convertPdfToWordBrowser(
  file: File,
  onProgress?: ConversionProgress
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Reading PDF…");
  const buffer = await file.arrayBuffer();
  const { pdf, release } = await openPdf(buffer).catch((error) => {
    if (error instanceof PdfReadError) throw new PdfToWordError(error.message, error.code);
    throw error;
  });

  if (pdf.numPages === 0) {
    throw new PdfToWordError("This PDF has no pages.", "empty");
  }

  const pages: Array<{ layout: PageLayout; pageImage: PdfImage | null }> = [];
  const rasterCache = createImageRasterCache();
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      // A one-page file used to jump straight to 86% (last page of an 80%
      // window) and sit there for the whole extract. Designed CVs spend their
      // time in that extract, so the bar looked stuck just before the end.
      const started = 6 + ((pageNumber - 1) / pdf.numPages) * 80;
      const finished = 6 + (pageNumber / pdf.numPages) * 80;
      onProgress?.(started, `Reading page ${pageNumber} of ${pdf.numPages}…`);
      await yieldUi();
      const page = await pdf.getPage(pageNumber);
      try {
        onProgress?.(
          started + (finished - started) * 0.2,
          `Rebuilding page ${pageNumber} of ${pdf.numPages}…`
        );
        await yieldUi();
        pages.push(await layoutPage(page, pageNumber, rasterCache));
      } catch (error) {
        console.warn(`pdf-to-word: page ${pageNumber} fell back to an image`, error);
        try {
          pages.push(await fallbackPage(page, pageNumber));
        } catch {
          // Skip the page rather than losing the whole document.
        }
      } finally {
        page.cleanup();
      }
      onProgress?.(finished, `Rebuilt page ${pageNumber} of ${pdf.numPages}…`);
      await yieldUi();
    }
  } finally {
    await release();
  }

  if (pages.length === 0) {
    throw new PdfToWordError("No page of this PDF could be converted.", "failed");
  }

  unifyMargins(pages.map((entry) => entry.layout));

  onProgress?.(90, "Building Word document…");
  await yieldUi();
  const bytes = await writeDocument(pages);
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const baseName = file.name.replace(/\.pdf$/i, "").trim() || "document";
  onProgress?.(100, "Done");
  return { blob, filename: `${baseName}.docx` };
}
