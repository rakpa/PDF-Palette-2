import { PdfReadError, readPdfLayouts } from "./pdf-to-word/read";
import { buildSheets } from "./pdf-to-excel/build";
import { writeWorkbook } from "./pdf-to-excel/xlsx-emit";

export { PdfReadError };

/**
 * PDF → Excel, in the browser.
 *
 * The same reader that rebuilds a PDF as a Word document is what finds the
 * tables here — recovering a grid from ruled lines and from columns that only
 * line up — and each page becomes a sheet. Text that is not in a table keeps
 * its reading order down the first column rather than being dropped.
 */
export async function convertPdfToExcelBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Reading PDF…");
  const buffer = await file.arrayBuffer();

  const pages = await readPdfLayouts(buffer, onProgress);
  if (pages.length === 0) {
    throw new PdfReadError("None of this PDF's pages could be read.", "failed");
  }

  onProgress?.(90, "Building workbook…");
  const sheets = buildSheets(pages.map((page) => page.layout));
  const withContent = sheets.filter((sheet) => sheet.cells.length > 0);
  if (withContent.length === 0) {
    throw new PdfReadError(
      "This PDF has no text to put in a spreadsheet — it may be a scan.",
      "empty"
    );
  }

  const bytes = await writeWorkbook(withContent);
  onProgress?.(100, "Done");

  return {
    blob: new Blob([bytes as unknown as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename: `${file.name.replace(/\.pdf$/i, "") || "document"}.xlsx`,
  };
}
