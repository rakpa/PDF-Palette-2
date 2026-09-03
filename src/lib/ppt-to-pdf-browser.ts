import { PDFDocument } from "pdf-lib";
import { embedStandardFonts } from "./office/fonts";
import { emitPdf } from "./office/pdf-emit";
import { placeSlides } from "./ppt-to-pdf/place";
import { readPresentation } from "./ppt-to-pdf/presentation";
import { PowerPointError } from "./ppt-to-pdf/types";

export { PowerPointError };

/**
 * PowerPoint → PDF, in the browser.
 *
 * Slides are already absolutely positioned, so this skips the flow layout the
 * Word and Excel paths use and produces placed pages directly — then hands
 * them to the same emitter.
 */
export async function convertPptToPdfBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(10, "Reading presentation…");
  const buffer = await file.arrayBuffer();

  onProgress?.(35, "Reading slides…");
  const presentation = await readPresentation(buffer);

  onProgress?.(60, "Placing shapes…");
  const pdf = await PDFDocument.create();
  const fonts = await embedStandardFonts(pdf);
  const pages = placeSlides(presentation, fonts);

  onProgress?.(80, "Writing PDF…");
  await emitPdf(pdf, fonts, pages);
  const bytes = await pdf.save();

  onProgress?.(100, "Done");
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    filename: `${file.name.replace(/\.(pptx|ppt)$/i, "") || "presentation"}.pdf`,
  };
}
