import type { Point } from "./types";

/** Font stacks offered for typed text and typed signatures. */
export const FONT_STACKS: Record<string, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  courier: "'Courier New', Courier, monospace",
  "signature-flow": "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive",
  "signature-formal": "'Lucida Handwriting', 'Apple Chancery', 'URW Chancery L', cursive",
};

export function fontStack(id: string): string {
  return FONT_STACKS[id] ?? FONT_STACKS.helvetica;
}

async function toPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** Trim fully transparent margins so a placed signature has no dead space. */
function trimTransparent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return canvas;
  }
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data.data[(y * canvas.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;

  const pad = Math.round(Math.max(canvas.width, canvas.height) * 0.02);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(canvas.width - 1, maxX + pad);
  maxY = Math.min(canvas.height - 1, maxY + pad);

  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  const outCtx = out.getContext("2d");
  if (!outCtx) return canvas;
  outCtx.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Smooth a captured stroke with a quadratic through the midpoints. */
export function strokePath(points: Point[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  if (points.length === 1) {
    path.moveTo(points[0].x, points[0].y);
    path.lineTo(points[0].x + 0.01, points[0].y);
    return path;
  }
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    path.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  const last = points[points.length - 1];
  path.lineTo(last.x, last.y);
  return path;
}

export type RasterResult = { data: Uint8Array; width: number; height: number };

/** Render drawn strokes to a transparent PNG. */
export async function rasterizeStrokes(
  strokes: Point[][],
  width: number,
  height: number,
  color: string,
  lineWidth: number,
  scale = 3
): Promise<RasterResult | null> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.stroke(strokePath(stroke));
  }
  const trimmed = trimTransparent(canvas);
  const data = await toPngBytes(trimmed);
  return data ? { data, width: trimmed.width, height: trimmed.height } : null;
}

/** Render a line of text to a transparent PNG — used for typed signatures. */
export async function rasterizeText(
  text: string,
  options: {
    fontId: string;
    fontSizePx: number;
    color: string;
    bold?: boolean;
    italic?: boolean;
    scale?: number;
  }
): Promise<RasterResult | null> {
  const scale = options.scale ?? 3;
  const measure = document.createElement("canvas");
  const measureCtx = measure.getContext("2d");
  if (!measureCtx) return null;
  const style = `${options.italic ? "italic " : ""}${options.bold ? "700 " : ""}`;
  const font = `${style}${options.fontSizePx}px ${fontStack(options.fontId)}`;
  measureCtx.font = font;
  const metrics = measureCtx.measureText(text);
  const width = Math.max(1, Math.ceil(metrics.width) + options.fontSizePx * 0.4);
  const height = Math.ceil(options.fontSizePx * 1.8);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.font = font;
  ctx.fillStyle = options.color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, options.fontSizePx * 0.2, height / 2);

  const trimmed = trimTransparent(canvas);
  const data = await toPngBytes(trimmed);
  return data ? { data, width: trimmed.width, height: trimmed.height } : null;
}

/**
 * Render a wrapped block of text to a transparent PNG.
 *
 * This is the fallback for scripts the PDF standard fonts cannot encode —
 * Cyrillic, Greek, CJK, emoji. The text stops being selectable, but it appears
 * exactly as it did on screen, which is the more important promise.
 */
export async function rasterizeTextBlock(
  lines: string[],
  options: {
    fontId: string;
    fontSizePt: number;
    lineHeight: number;
    color: string;
    bold: boolean;
    italic: boolean;
    align: "left" | "center" | "right";
    widthPt: number;
    scale?: number;
  }
): Promise<RasterResult | null> {
  const scale = options.scale ?? 3;
  const lineHeightPt = options.fontSizePt * options.lineHeight;
  const heightPt = Math.max(lineHeightPt, lines.length * lineHeightPt);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(options.widthPt * scale));
  canvas.height = Math.max(1, Math.round(heightPt * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  const style = `${options.italic ? "italic " : ""}${options.bold ? "700 " : ""}`;
  ctx.font = `${style}${options.fontSizePt}px ${fontStack(options.fontId)}`;
  ctx.fillStyle = options.color;
  ctx.textBaseline = "alphabetic";

  lines.forEach((line, i) => {
    const y = i * lineHeightPt + options.fontSizePt * 0.82;
    const textWidth = ctx.measureText(line).width;
    const x =
      options.align === "center"
        ? (options.widthPt - textWidth) / 2
        : options.align === "right"
          ? options.widthPt - textWidth
          : 0;
    ctx.fillText(line, Math.max(0, x), y);
  });

  const data = await toPngBytes(canvas);
  return data ? { data, width: canvas.width, height: canvas.height } : null;
}

export async function imageFileToPng(file: File): Promise<RasterResult | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The image could not be read."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const data = await toPngBytes(canvas);
    return data ? { data, width: canvas.width, height: canvas.height } : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Lift a signature off the paper it was photographed on: drop near-white
 * pixels to transparent and deepen what is left.
 */
export async function removeBackground(source: RasterResult): Promise<RasterResult | null> {
  const image = await createImageBitmap(new Blob([source.data], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  image.close?.();

  let pixels: ImageData;
  try {
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return source;
  }
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const luminance = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    if (luminance > 0.75) {
      d[i + 3] = 0;
    } else {
      // Ramp the remaining ink up to full opacity so it does not look washed out.
      d[i + 3] = Math.round(Math.min(1, (0.75 - luminance) / 0.35) * 255);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const trimmed = trimTransparent(canvas);
  const data = await toPngBytes(trimmed);
  return data ? { data, width: trimmed.width, height: trimmed.height } : null;
}
