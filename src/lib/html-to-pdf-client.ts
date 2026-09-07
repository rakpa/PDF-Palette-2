import { convertHtmlUrlToPdfIlove } from "./ilovepdf-direct";
import { renderHtmlFileToPdf } from "./html-to-pdf-browser";

/**
 * HTML → PDF.
 *
 * An uploaded file is laid out and captured by the browser itself.
 * A URL cannot be: same-origin policy stops a tab reading another site's
 * HTML, so that path uses the same remote convert session as Word ↔ PDF
 * (without naming the provider in the UI).
 */
export async function htmlToPdfLocal(
  input: { file?: File; url?: string },
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const url = input.url?.trim();
  const file = input.file;

  if (!url && !file) {
    throw new Error("Provide either an HTML file or a URL.");
  }

  if (file) {
    return renderHtmlFileToPdf(file, onProgress);
  }

  return convertHtmlUrlToPdfIlove(url as string, onProgress);
}
