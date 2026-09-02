/** Canvas helpers shared by the image and artwork extractors. */

export type Raster = { data: Uint8Array; type: "png" | "jpg" };

export function canvasAvailable(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

export function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (!canvasAvailable()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export async function canvasToRaster(
  canvas: HTMLCanvasElement,
  preferJpeg: boolean
): Promise<Raster | null> {
  const type = preferJpeg ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, type, preferJpeg ? 0.85 : undefined);
    } catch {
      resolve(null);
    }
  });
  if (!blob) return null;
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data.length === 0) return null;
  return { data, type: preferJpeg ? "jpg" : "png" };
}

/** True when the pixels contain any non-opaque alpha, which rules out JPEG. */
export function hasTransparency(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) return true;
  }
  return false;
}
