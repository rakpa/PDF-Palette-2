import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

/** Extract readable text from every page into a .txt download. */
export async function extractTextLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Opening PDF…");
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjsLib.getDocument({
    data: data.slice(),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    void task.destroy().catch(() => undefined);
    throw new Error("This file could not be read as a PDF.");
  }

  try {
    const parts: string[] = [];
    const total = pdf.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ("str" in item ? String(item.str) : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) parts.push(line);
      parts.push("");
      page.cleanup();
      onProgress?.(10 + Math.round((n / total) * 85), `Page ${n} of ${total}…`);
    }

    const text = parts.join("\n").trim();
    if (!text) {
      throw new Error(
        "No text was found. Try OCR PDF first if this is a scanned document."
      );
    }

    onProgress?.(100, "Done");
    const base = file.name.replace(/\.pdf$/i, "") || "document";
    return {
      blob: new Blob([text + "\n"], { type: "text/plain;charset=utf-8" }),
      filename: `${base}.txt`,
    };
  } finally {
    await pdf.destroy().catch(() => undefined);
    void task.destroy().catch(() => undefined);
  }
}

/** Return plain text for summarize / chat / PII tools. */
export async function extractPdfTextString(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<string> {
  const { blob } = await extractTextLocal(file, onProgress);
  return blob.text();
}
