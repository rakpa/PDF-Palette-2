import { PDFDocument } from "pdf-lib";
import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

/**
 * Flatten a PDF so forms and interactive content can no longer be edited.
 *
 * Form fields are flattened when present. Every page is then redrawn as a
 * static image page so annotations and widgets cannot be changed later.
 */
export async function flattenPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(5, "Opening PDF…");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Prefer form flatten first so field appearances are baked in before raster.
  try {
    const editable = await PDFDocument.load(bytes, { ignoreEncryption: false });
    try {
      const form = editable.getForm();
      if (form.getFields().length > 0) {
        onProgress?.(12, "Flattening form fields…");
        form.flatten();
      }
    } catch {
      // No AcroForm — continue with a visual flatten.
    }
    const prepared = await editable.save();
    return rasterizeToPdf(prepared, file.name, onProgress);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) {
      throw new Error("This PDF is password protected. Unlock it first.");
    }
    throw new Error("This file could not be read as a PDF.");
  }
}

async function rasterizeToPdf(
  data: Uint8Array,
  originalName: string,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
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
    const out = await PDFDocument.create();
    const total = pdf.numPages;
    const scale = 150 / 72;

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
        15 + Math.round((number / total) * 80),
        `Flattening page ${number} of ${total}…`
      );
    }

    onProgress?.(98, "Saving…");
    const saved = await out.save();
    onProgress?.(100, "Done");
    const base = originalName.replace(/\.pdf$/i, "") || "document";
    return {
      blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
      filename: `${base}-flat.pdf`,
    };
  } finally {
    void task.destroy().catch(() => undefined);
  }
}
