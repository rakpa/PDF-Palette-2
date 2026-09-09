import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createZip } from "./zip-write";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

/**
 * Extract embedded images when possible; otherwise rasterize each page as PNG.
 */
export async function extractImagesLocal(
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

  const images: { name: string; bytes: Uint8Array; type: string }[] = [];

  try {
    const total = pdf.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const ops = await page.getOperatorList();
      const fns = pdfjsLib.OPS;
      const seen = new Set<string>();

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn !== fns.paintImageXObject && fn !== fns.paintInlineImageXObject) continue;
        const args = ops.argsArray[i] as unknown[];
        const name = typeof args[0] === "string" ? args[0] : null;
        if (!name || seen.has(name)) continue;
        seen.add(name);

        try {
          const obj = await page.objs.get(name);
          if (!obj || typeof obj !== "object") continue;
          const img = obj as {
            width?: number;
            height?: number;
            data?: Uint8ClampedArray | Uint8Array;
            kind?: number;
          };
          if (!img.width || !img.height || !img.data) continue;
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const imageData = ctx.createImageData(img.width, img.height);
          const src = img.data;
          // pdf.js image kinds vary; copy what we can into RGBA.
          if (src.length >= img.width * img.height * 4) {
            imageData.data.set(src.subarray(0, imageData.data.length));
          } else if (src.length >= img.width * img.height * 3) {
            for (let p = 0, q = 0; p < imageData.data.length; p += 4, q += 3) {
              imageData.data[p] = src[q];
              imageData.data[p + 1] = src[q + 1];
              imageData.data[p + 2] = src[q + 2];
              imageData.data[p + 3] = 255;
            }
          } else if (src.length >= img.width * img.height) {
            for (let p = 0, q = 0; p < imageData.data.length; p += 4, q++) {
              const v = src[q];
              imageData.data[p] = v;
              imageData.data[p + 1] = v;
              imageData.data[p + 2] = v;
              imageData.data[p + 3] = 255;
            }
          } else {
            continue;
          }
          ctx.putImageData(imageData, 0, 0);
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/png")
          );
          if (!blob) continue;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          images.push({
            name: `page-${n}-${name}.png`,
            bytes,
            type: "image/png",
          });
        } catch {
          // Skip unreadable image objects.
        }
      }

      // Fallback: if no embedded images on this page, save a page render.
      if (seen.size === 0) {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/png")
          );
          if (blob) {
            images.push({
              name: `page-${n}.png`,
              bytes: new Uint8Array(await blob.arrayBuffer()),
              type: "image/png",
            });
          }
        }
      }

      page.cleanup();
      onProgress?.(10 + Math.round((n / total) * 80), `Page ${n} of ${total}…`);
    }
  } finally {
    await pdf.destroy().catch(() => undefined);
    void task.destroy().catch(() => undefined);
  }

  if (images.length === 0) {
    throw new Error("No images could be extracted from this PDF.");
  }

  onProgress?.(95, "Packaging…");
  const base = file.name.replace(/\.pdf$/i, "") || "document";

  if (images.length === 1) {
    onProgress?.(100, "Done");
    return {
      blob: new Blob([images[0].bytes], { type: images[0].type }),
      filename: images[0].name.startsWith("page-") ? `${base}.png` : images[0].name,
    };
  }

  const zipBytes = await createZip(
    images.map((img) => ({
      name: img.name,
      data: img.bytes,
    }))
  );
  onProgress?.(100, "Done");
  return {
    blob: new Blob([zipBytes], { type: "application/zip" }),
    filename: `${base}-images.zip`,
  };
}
