import { conversionServiceUrl } from "./runtime-config";
import { convertPdfToWordBrowser } from "./pdf-to-word-browser";

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header);
  return match?.[1]?.replace(/"/g, "") ?? null;
}

export async function convertPdfToWordLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(10, "Uploading PDF…");

  const form = new FormData();
  form.append("file", file, file.name);

  onProgress?.(35, "Reconstructing layout…");

  let res: Response;
  try {
    res = await fetch(
      conversionServiceUrl("/api/pdf-to-word/convert", "/v1/pdf-to-word/convert"),
      {
      method: "POST",
      body: form,
      }
    );
  } catch {
    onProgress?.(20, "Converting in browser…");
    return convertPdfToWordBrowser(file, onProgress);
  }

  if (!res.ok) {
    onProgress?.(20, "Converting in browser…");
    return convertPdfToWordBrowser(file, onProgress);
  }

  onProgress?.(90, "Preparing download…");
  const blob = await res.blob();
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  const filename =
    filenameFromDisposition(res.headers.get("Content-Disposition")) ?? `${baseName}.docx`;

  onProgress?.(100, "Done");
  return { blob, filename };
}

