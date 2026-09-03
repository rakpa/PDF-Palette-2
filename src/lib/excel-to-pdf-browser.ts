import { PDFDocument } from "pdf-lib";
import { embedStandardFonts } from "./office/fonts";
import { layoutDocument } from "./office/layout";
import { emitPdf } from "./office/pdf-emit";
import { extractWorkbook } from "./excel-to-pdf/excel-extract";
import { ExcelError } from "./excel-to-pdf/workbook";

export { ExcelError };

/**
 * Excel → PDF, in the browser.
 *
 * The workbook is read into the same document model Word files use, so the
 * layout pass and PDF emitter are shared: a sheet is a table, and everything
 * that already knows how to place a table across pages applies unchanged.
 */
export async function convertExcelToPdfBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(10, "Reading workbook…");
  const buffer = await file.arrayBuffer();

  onProgress?.(30, "Reading sheets…");
  const document = await extractWorkbook(buffer);

  onProgress?.(55, "Laying out pages…");
  const pdf = await PDFDocument.create();
  const fonts = await embedStandardFonts(pdf);
  const pages = layoutDocument(document, fonts);

  onProgress?.(80, "Writing PDF…");
  await emitPdf(pdf, fonts, pages);
  const bytes = await pdf.save();

  onProgress?.(100, "Done");
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    filename: `${file.name.replace(/\.(xlsx|xlsm|xls)$/i, "") || "workbook"}.pdf`,
  };
}
