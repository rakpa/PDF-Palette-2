import { PDFDocument } from "pdf-lib";

/**
 * Rebuild a PDF by copying pages into a fresh document.
 * Fixes many structurally broken files that still open in pdf-lib.
 */
export async function repairPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Opening PDF…");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) {
      throw new Error("This PDF is password protected. Unlock it first.");
    }
    throw new Error("This file could not be read as a PDF.");
  }

  onProgress?.(25, "Rebuilding pages…");
  const out = await PDFDocument.create();
  const indices = source.getPageIndices();
  const copied = await out.copyPages(source, indices);
  for (let i = 0; i < copied.length; i++) {
    out.addPage(copied[i]);
    onProgress?.(25 + Math.round(((i + 1) / copied.length) * 65), `Page ${i + 1} of ${copied.length}…`);
  }

  try {
    const title = source.getTitle();
    const author = source.getAuthor();
    const subject = source.getSubject();
    const keywords = source.getKeywords();
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
    if (subject) out.setSubject(subject);
    if (keywords) out.setKeywords(keywords);
  } catch {
    // Metadata optional on damaged files.
  }

  onProgress?.(95, "Saving…");
  const saved = await out.save();
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}-repaired.pdf`,
  };
}
