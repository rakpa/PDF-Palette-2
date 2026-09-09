import { PDFDocument } from "pdf-lib";
import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

function keywordList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map((k) => k.trim()).filter(Boolean);
  return String(raw)
    .split(/[,;\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

async function copyMetadata(source: PDFDocument, out: PDFDocument): Promise<void> {
  try {
    const title = source.getTitle();
    const author = source.getAuthor();
    const subject = source.getSubject();
    const keywords = keywordList(source.getKeywords());
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
    if (subject) out.setSubject(subject);
    // getKeywords() returns a string; setKeywords() expects string[].
    if (keywords.length) out.setKeywords(keywords);
  } catch {
    // Metadata optional on damaged files.
  }
}

/** Last-resort rebuild: rasterize every page pdf.js can open into a fresh PDF. */
async function salvageViaRaster(
  bytes: Uint8Array,
  onProgress?: (progress: number, message?: string) => void
): Promise<PDFDocument> {
  onProgress?.(20, "Recovering damaged pages…");
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
    stopAtErrors: false,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    void task.destroy().catch(() => undefined);
    throw new Error("This file could not be read as a PDF.");
  }

  try {
    const total = pdf.numPages;
    if (!total) throw new Error("This PDF has no pages to repair.");

    const out = await PDFDocument.create();
    const scale = 144 / 72;

    for (let number = 1; number <= total; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser could not render the page.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("This browser could not encode the page.");
      const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const pdfPage = out.addPage([image.width, image.height]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });

      onProgress?.(
        20 + Math.round((number / total) * 70),
        `Recovered page ${number} of ${total}…`
      );
    }

    return out;
  } finally {
    try {
      pdf.cleanup?.();
    } catch {
      /* ignore */
    }
    void task.destroy().catch(() => undefined);
  }
}

/**
 * Rebuild a PDF by copying pages into a fresh document.
 * Fixes many structurally broken files that still open in pdf-lib.
 * Falls back to a pdf.js raster salvage when the structure cannot be copied.
 */
export async function repairPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Opening PDF…");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let out: PDFDocument | null = null;

  try {
    const source = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });

    onProgress?.(25, "Rebuilding pages…");
    out = await PDFDocument.create();
    const indices = Array.isArray(source.getPageIndices()) ? source.getPageIndices() : [];
    if (indices.length === 0) {
      throw new Error("empty");
    }
    const copied = await out.copyPages(source, indices);
    if (!Array.isArray(copied) || copied.length === 0) {
      throw new Error("empty");
    }
    for (let i = 0; i < copied.length; i++) {
      out.addPage(copied[i]);
      onProgress?.(25 + Math.round(((i + 1) / copied.length) * 65), `Page ${i + 1} of ${copied.length}…`);
    }
    await copyMetadata(source, out);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) {
      throw new Error("This PDF is password protected. Unlock it first.");
    }
    // Structural copy failed — try recovering whatever pdf.js can still render.
    out = await salvageViaRaster(bytes, onProgress);
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
