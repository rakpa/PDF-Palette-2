import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createZip } from "./zip-write";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export type ImageFormat = "jpg" | "png";

export interface PdfToImageOptions {
  format: ImageFormat;
  /** Render resolution. 150 is screen-sharp; 300 is print quality. */
  dpi: number;
  /** JPEG quality, 0–1. Ignored for PNG. */
  quality?: number;
  /** One-based and inclusive; 0 for `toPage` means "to the end". */
  fromPage?: number;
  toPage?: number;
}

export class PdfToImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfToImageError";
  }
}

/**
 * Render pages to images.
 *
 * A single page comes back as that image; several come back zipped, because a
 * browser download is one file. Pages are rendered through pdf.js at the
 * requested resolution, with their own `/Rotate` already applied by the
 * viewport, so what lands in the image is what a reader would see.
 */
export async function pdfToImages(
  file: File,
  options: PdfToImageOptions,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const buffer = await file.arrayBuffer();
  const scale = Math.max(0.2, Math.min(6, (options.dpi || 150) / 72));

  // The loading task, not the document, owns the worker — releasing it is what
  // frees the page data when the job is done or has failed.
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    void task.destroy().catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    if (/password/i.test(message)) {
      throw new PdfToImageError("This PDF is password protected. Unlock it first.");
    }
    throw new PdfToImageError("This file could not be read as a PDF.");
  }

  try {
    const total = pdf.numPages;
    const from = Math.max(1, Math.min(options.fromPage || 1, total));
    const to = options.toPage && options.toPage > 0 ? Math.min(options.toPage, total) : total;
    if (to < from) throw new PdfToImageError("The last page comes before the first page.");

    const mime = options.format === "png" ? "image/png" : "image/jpeg";
    const extension = options.format === "png" ? "png" : "jpg";
    const quality = options.format === "png" ? undefined : (options.quality ?? 0.92);
    const baseName = file.name.replace(/\.pdf$/i, "") || "page";
    const pad = String(to).length;

    const images: Array<{ name: string; data: Uint8Array }> = [];

    for (let number = from; number <= to; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new PdfToImageError("This browser could not render the page.");

      // JPEG has no transparency, so an unpainted page would come out black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, quality)
      );
      if (!blob) throw new PdfToImageError("This browser could not encode the image.");

      images.push({
        name: `${baseName}-${String(number).padStart(pad, "0")}.${extension}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });

      onProgress?.(
        10 + Math.round(((number - from + 1) / (to - from + 1)) * 80),
        `Page ${number - from + 1} of ${to - from + 1}…`
      );
    }

    if (images.length === 1) {
      onProgress?.(100, "Done");
      return {
        blob: new Blob([images[0].data as unknown as BlobPart], { type: mime }),
        filename: images[0].name,
      };
    }

    onProgress?.(94, "Packing images…");
    const zip = await createZip(images);
    onProgress?.(100, "Done");
    return {
      blob: new Blob([zip as unknown as BlobPart], { type: "application/zip" }),
      filename: `${baseName}-${extension}.zip`,
    };
  } finally {
    void task.destroy().catch(() => undefined);
  }
}
