import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createZip } from "./zip-write";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function rgbaFromPdfImage(img: {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}): ImageData | null {
  const { width, height, data: src } = img;
  const imageData = new ImageData(width, height);
  const need = width * height;
  if (src.length >= need * 4) {
    imageData.data.set(src.subarray(0, imageData.data.length));
    return imageData;
  }
  if (src.length >= need * 3) {
    for (let p = 0, q = 0; p < imageData.data.length; p += 4, q += 3) {
      imageData.data[p] = src[q];
      imageData.data[p + 1] = src[q + 1];
      imageData.data[p + 2] = src[q + 2];
      imageData.data[p + 3] = 255;
    }
    return imageData;
  }
  if (src.length >= need) {
    for (let p = 0, q = 0; p < imageData.data.length; p += 4, q++) {
      const v = src[q];
      imageData.data[p] = v;
      imageData.data[p + 1] = v;
      imageData.data[p + 2] = v;
      imageData.data[p + 3] = 255;
    }
    return imageData;
  }
  return null;
}

async function renderPagePng(
  page: pdfjsLib.PDFPageProxy,
  scale = 1.5
): Promise<Uint8Array | null> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvasToPngBytes(canvas);
}

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
      let extractedOnPage = 0;

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (fn !== fns.paintImageXObject && fn !== fns.paintInlineImageXObject) continue;
        const args = ops.argsArray[i] as unknown[];
        const name = typeof args[0] === "string" ? args[0] : `inline-${i}`;
        if (seen.has(name)) continue;
        seen.add(name);

        try {
          let obj: unknown = null;
          if (typeof args[0] === "string") {
            try {
              obj = await page.objs.get(name);
            } catch {
              obj = null;
            }
            if (!obj && pdf.objs) {
              try {
                obj = await pdf.objs.get(name);
              } catch {
                obj = null;
              }
            }
          } else if (args[0] && typeof args[0] === "object") {
            obj = args[0];
          }
          if (!obj || typeof obj !== "object") continue;
          const img = obj as {
            width?: number;
            height?: number;
            data?: Uint8ClampedArray | Uint8Array;
            bitmap?: ImageBitmap;
          };

          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          if (img.bitmap && img.width && img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img.bitmap, 0, 0);
          } else if (img.width && img.height && img.data) {
            const imageData = rgbaFromPdfImage({
              width: img.width,
              height: img.height,
              data: img.data,
            });
            if (!imageData) continue;
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.putImageData(imageData, 0, 0);
          } else {
            continue;
          }

          const bytes = await canvasToPngBytes(canvas);
          if (!bytes) continue;
          images.push({
            name: `page-${n}-${extractedOnPage + 1}.png`,
            bytes,
            type: "image/png",
          });
          extractedOnPage += 1;
        } catch {
          // Skip unreadable image objects — page render fallback below.
        }
      }

      // Always fall back when nothing usable was decoded on this page.
      if (extractedOnPage === 0) {
        const bytes = await renderPagePng(page);
        if (bytes) {
          images.push({
            name: `page-${n}.png`,
            bytes,
            type: "image/png",
          });
        }
      }

      page.cleanup();
      onProgress?.(10 + Math.round((n / total) * 80), `Page ${n} of ${total}…`);
    }
  } finally {
    try {
      pdf.cleanup?.();
    } catch {
      /* ignore */
    }
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
      blob: new Blob([images[0].bytes as unknown as BlobPart], { type: images[0].type }),
      filename: `${base}.png`,
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
    blob: new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" }),
    filename: `${base}-images.zip`,
  };
}
