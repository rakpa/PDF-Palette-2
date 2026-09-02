import { loadHtmlFrame } from "./html-to-pdf/frame";
import { paginate } from "./html-to-pdf/paginate";
import { renderPages } from "./html-to-pdf/render";
import { extractTextLayer } from "./html-to-pdf/text-layer";

/**
 * HTML → PDF, entirely in the browser.
 *
 * The file is laid out by the browser's own engine in a script-free sandbox,
 * captured page by page, and paired with an invisible text layer taken from
 * the live DOM — so the PDF looks exactly like the page and its text is still
 * selectable and searchable. Nothing is uploaded anywhere.
 */
export async function renderHtmlFileToPdf(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(8, "Reading file…");
  const html = await file.text();
  if (!html.trim()) throw new Error("That file is empty.");

  onProgress?.(20, "Laying out the page…");
  const loaded = await loadHtmlFrame(html);

  try {
    onProgress?.(40, "Measuring text…");
    const { lines, boxes, forcedBreaks } = extractTextLayer(loaded.doc);

    const { breaks, contentHeight } = paginate(loaded.contentHeight, boxes, forcedBreaks);

    onProgress?.(55, "Rendering pages…");
    const bytes = await renderPages({
      doc: loaded.doc,
      lines,
      breaks,
      contentHeight,
      onProgress,
    });

    const baseName = file.name.replace(/\.[^.]+$/, "").trim() || "page";
    onProgress?.(100, "Done");
    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
      filename: `${baseName}.pdf`,
    };
  } finally {
    loaded.dispose();
  }
}
