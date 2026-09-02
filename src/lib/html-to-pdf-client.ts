import { parseConversionFetchError } from "./conversion-service-client";
import { conversionServiceUrl } from "./runtime-config";
import { renderHtmlFileToPdf } from "./html-to-pdf-browser";

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
  return match?.[1]?.replace(/"/g, "") ?? null;
}

/**
 * HTML → PDF.
 *
 * An uploaded file is laid out and captured by the browser itself, so it needs
 * nothing from the server. A URL cannot be: the page has to be fetched, and
 * the same-origin policy stops a tab reading another site's HTML — so that
 * path still goes through the conversion service.
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

  onProgress?.(10, "Fetching page…");

  const form = new FormData();
  form.append("url", url as string);

  onProgress?.(35, "Rendering page…");

  let res: Response;
  try {
    res = await fetch(
      conversionServiceUrl("/api/html-to-pdf/convert", "/v1/html-to-pdf/convert"),
      { method: "POST", body: form }
    );
  } catch (error) {
    throw new Error(parseConversionFetchError(error));
  }

  if (!res.ok) {
    let message = "HTML to PDF failed";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      message = `${message} (HTTP ${res.status})`;
    }
    throw new Error(message);
  }

  onProgress?.(90, "Preparing download…");
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "page.pdf";

  onProgress?.(100, "Done");
  return { blob, filename };
}
