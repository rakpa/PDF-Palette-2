import { PDFDocument } from "pdf-lib";
import { embedStandardFonts } from "./office/fonts";
import { layoutDocument } from "./office/layout";
import { emitPdf } from "./office/pdf-emit";
import { extractWordDocument } from "./word-to-pdf/word-extract";

export class WordToPdfError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported" | "corrupt" | "empty" | "failed"
  ) {
    super(message);
    this.name = "WordToPdfError";
  }
}

export type ConversionProgress = (progress: number, message?: string) => void;

function isLegacyDoc(name: string): boolean {
  return /\.doc$/i.test(name) && !/\.docx$/i.test(name);
}

/**
 * Rebuild a Word document as a PDF in the browser.
 *
 * Same shape as PDF → Word: extract the document into a layout model, paginate
 * it, then emit. Development and production share this engine, so the file
 * never leaves the machine.
 */
export async function convertWordToPdfBrowser(
  file: File,
  onProgress?: ConversionProgress
): Promise<{ blob: Blob; filename: string }> {
  if (isLegacyDoc(file.name)) {
    throw new WordToPdfError(
      "Legacy .doc files aren't supported. Save the document as .docx, then convert.",
      "unsupported"
    );
  }
  if (!/\.docx$/i.test(file.name)) {
    throw new WordToPdfError("Please upload a .docx Word document.", "unsupported");
  }

  onProgress?.(8, "Reading document…");
  const buffer = await file.arrayBuffer();

  let documentModel;
  try {
    documentModel = await extractWordDocument(buffer);
  } catch (error) {
    if (error instanceof WordToPdfError) throw error;
    throw new WordToPdfError(
      error instanceof Error ? error.message : "This file is not a readable Word document.",
      "corrupt"
    );
  }

  if (documentModel.sections.length === 0) {
    throw new WordToPdfError("This document has no pages.", "empty");
  }

  onProgress?.(40, "Rebuilding layout…");
  const pdf = await PDFDocument.create();
  pdf.setTitle(file.name.replace(/\.docx$/i, "") || "document");
  pdf.setProducer("PDF Palette");
  const fonts = await embedStandardFonts(pdf);
  const pages = layoutDocument(documentModel, fonts);
  if (pages.length === 0) {
    throw new WordToPdfError("This document has no pages.", "empty");
  }

  onProgress?.(75, "Building PDF…");
  try {
    await emitPdf(pdf, fonts, pages);
  } catch (error) {
    throw new WordToPdfError(
      error instanceof Error ? error.message : "The PDF could not be built.",
      "failed"
    );
  }

  onProgress?.(95, "Packing PDF…");
  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const baseName = file.name.replace(/\.docx$/i, "").trim() || "document";
  onProgress?.(100, "Done");
  return { blob, filename: `${baseName}.pdf` };
}
