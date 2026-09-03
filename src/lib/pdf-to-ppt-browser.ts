import { PdfReadError, readPdfLayouts } from "./pdf-to-word/read";
import { buildSlides } from "./pdf-to-ppt/build";
import { writePresentation } from "./pdf-to-ppt/pptx-emit";

export { PdfReadError };

/**
 * PDF → PowerPoint, in the browser.
 *
 * One slide per page, at the page's own size. Because a slide is a canvas and
 * a PDF page already is one, nothing is reflowed: each paragraph becomes a
 * text box where it stood, and tables arrive as editable tables.
 */
export async function convertPdfToPptBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Reading PDF…");
  const buffer = await file.arrayBuffer();

  const pages = await readPdfLayouts(buffer, onProgress);
  if (pages.length === 0) {
    throw new PdfReadError("None of this PDF's pages could be read.", "failed");
  }

  onProgress?.(90, "Building slides…");
  const { slides, width, height } = buildSlides(pages.map((page) => page.layout));
  const bytes = await writePresentation(slides, width, height);

  onProgress?.(100, "Done");
  return {
    blob: new Blob([bytes as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }),
    filename: `${file.name.replace(/\.pdf$/i, "") || "document"}.pptx`,
  };
}
