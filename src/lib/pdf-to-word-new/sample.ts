import type { PDFPageProxy } from "pdfjs-dist";
import type { Rect } from "../pdf-to-word/types";

/**
 * Reading the colour a painted area actually has.
 *
 * The page scanner tracks the fill colour through the content stream, which
 * works for a flat `rg`/`k`/`g` fill and not for the rest: a pattern or a
 * shading is named, not coloured, so the scanner keeps whatever colour was set
 * before it — usually the initial black. A gradient panel then reaches Word as
 * a solid black box.
 *
 * Rather than teach the scanner every colour space, the page is rendered once
 * and each rectangle is read off the result. That is the colour the reader
 * will see, whatever produced it, and it costs one raster per page.
 */

const SAMPLE_DPI = 110;
const MAX_DIM = 2200;
/** Quantisation used to find the area's dominant colour, in levels/channel. */
const LEVELS = 24;
/** Channel difference across an axis that means the area is a gradient. */
const GRADIENT_DELTA = 22;
/** Grid used to sweep the page for paint nothing else accounts for. */
const CELL_PT = 6;
/** A cell counts as painted only when one colour holds this much of it. */
const SOLID_SHARE = 0.72;
/** How far a pixel may sit from the cell's centre colour and still count. */
const SOLID_TOLERANCE = 26;
/** Cells merge into one panel while their colours stay this close. */
const MERGE_DELTA = 26;
/** A panel has to run at least this far each way, and cover this much. */
const MIN_SPAN_PT = 10;
const MIN_AREA_PT = 900;

export type PaintedFill = {
  rect: Rect;
  color: string;
  /** Set when the area runs between two colours. */
  color2?: string;
  /** VML gradient angle: 0 runs bottom to top, 90 runs right to left. */
  angle?: number;
};

function hex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function channelGap(a: string, b: string): number {
  let worst = 0;
  for (let i = 0; i < 6; i += 2) {
    worst = Math.max(worst, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
  }
  return worst;
}

/**
 * The area's dominant colour: the most common quantised bucket, averaged over
 * the pixels that fall in it. A mode rather than a mean, so text drawn on a
 * panel, or a logo sitting on it, does not drag the answer towards grey.
 */
function dominant(
  data: Uint8ClampedArray,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): string | null {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const stepX = Math.max(1, Math.floor((x1 - x0) / 48));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 48));
  let total = 0;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = y * stride + x * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key =
        (Math.floor((r * LEVELS) / 256) << 10) |
        (Math.floor((g * LEVELS) / 256) << 5) |
        Math.floor((b * LEVELS) / 256);
      const bucket = counts.get(key);
      if (bucket) {
        bucket.n += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      } else {
        counts.set(key, { n: 1, r, g, b });
      }
      total += 1;
    }
  }
  if (total === 0) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of counts.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return null;
  return hex(best.r / best.n, best.g / best.n, best.b / best.n);
}

/**
 * The dominant colour of a cell, with the share of the cell it covers. A cell
 * sitting on a line of text is a mix of paper and ink and no colour dominates,
 * which is what keeps the sweep below off the text.
 */
function cellColour(
  data: Uint8ClampedArray,
  stride: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { color: string; share: number } | null {
  const samples: number[] = [];
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = y * stride + x * 4;
      samples.push(data[i], data[i + 1], data[i + 2]);
    }
  }
  const total = samples.length / 3;
  if (total === 0) return null;

  // The middle sample of each channel: a robust centre that ink on paper
  // cannot pull far, since ink is the minority there.
  const mid = (offset: number) => {
    const values: number[] = [];
    for (let i = offset; i < samples.length; i += 3) values.push(samples[i]);
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  };
  const r = mid(0);
  const g = mid(1);
  const b = mid(2);

  // Share is measured by nearness, not by an exact bucket: a gradient drifts
  // across a cell and would otherwise never look solid, while ink and paper
  // stay far apart and still will not.
  let near = 0;
  for (let i = 0; i < samples.length; i += 3) {
    if (
      Math.abs(samples[i] - r) <= SOLID_TOLERANCE &&
      Math.abs(samples[i + 1] - g) <= SOLID_TOLERANCE &&
      Math.abs(samples[i + 2] - b) <= SOLID_TOLERANCE
    ) {
      near += 1;
    }
  }
  return { color: hex(r, g, b), share: near / total };
}

function isPaper(color: string): boolean {
  return (
    parseInt(color.slice(0, 2), 16) >= 244 &&
    parseInt(color.slice(2, 4), 16) >= 244 &&
    parseInt(color.slice(4, 6), 16) >= 244
  );
}

/**
 * Render the page once and hand back a reader for it. Returns null when the
 * page cannot be rastered, in which case callers keep the scanner's colours.
 */
export type PageSampler = {
  /** The colour a given rectangle actually has on the page. */
  read: (rect: Rect, fallback: string) => PaintedFill;
  /** Panels the scanner never reported, given what is already covered. */
  sweep: (covered: Rect[]) => PaintedFill[];
};

export async function createSampler(
  page: PDFPageProxy,
  width: number,
  height: number
): Promise<PageSampler | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(SAMPLE_DPI / 72, MAX_DIM / Math.max(base.width, base.height, 1));
  const viewport = page.getViewport({ scale });
  let canvas: HTMLCanvasElement;
  let data: ImageData;
  try {
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    data = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch (error) {
    console.warn("pdf-to-word: page could not be sampled for colour", error);
    return null;
  }
  canvas.width = 0;
  canvas.height = 0;

  const sx = data.width / Math.max(1, width);
  const sy = data.height / Math.max(1, height);
  const pixels = data.data;
  const stride = data.width * 4;

  const read = (rect: Rect, fallback: string): PaintedFill => {
    const plain: PaintedFill = { rect, color: fallback };
    // Stay off the edge: a border or an adjacent shape would be read as the
    // area's own colour.
    const insetX = Math.min(2, (rect.x1 - rect.x0) * 0.12);
    const insetY = Math.min(2, (rect.y1 - rect.y0) * 0.12);
    const x0 = Math.max(0, Math.round((rect.x0 + insetX) * sx));
    const y0 = Math.max(0, Math.round((rect.y0 + insetY) * sy));
    const x1 = Math.min(data.width, Math.round((rect.x1 - insetX) * sx));
    const y1 = Math.min(data.height, Math.round((rect.y1 - insetY) * sy));
    if (x1 - x0 < 1 || y1 - y0 < 1) return plain;

    const whole = dominant(pixels, stride, x0, y0, x1, y1);
    if (!whole) return plain;

    const thirdX = Math.max(1, Math.floor((x1 - x0) / 3));
    const thirdY = Math.max(1, Math.floor((y1 - y0) / 3));
    const left = dominant(pixels, stride, x0, y0, x0 + thirdX, y1);
    const right = dominant(pixels, stride, x1 - thirdX, y0, x1, y1);
    const top = dominant(pixels, stride, x0, y0, x1, y0 + thirdY);
    const bottom = dominant(pixels, stride, x0, y1 - thirdY, x1, y1);

    const acrossX = left && right ? channelGap(left, right) : 0;
    const acrossY = top && bottom ? channelGap(top, bottom) : 0;
    // VML runs its gradient from `color` towards `color2` against the angle's
    // direction, so the far edge is named first.
    if (acrossX >= GRADIENT_DELTA && acrossX >= acrossY) {
      return { rect, color: right!, color2: left!, angle: 90 };
    }
    if (acrossY >= GRADIENT_DELTA) {
      return { rect, color: bottom!, color2: top!, angle: 0 };
    }
    return { rect, color: whole };
  };

  /**
   * Everything painted that the scanner did not report.
   *
   * A page can be coloured by a mechanism no content-stream reader resolves —
   * a shading painted through a clip, a tiling pattern, a soft mask. Rather
   * than model each one, the rendered page is swept on a coarse grid: a cell
   * that is solidly one colour, is not paper, and is not already covered by
   * something being emitted, is a panel that would otherwise come out blank.
   * Cells over text never qualify, because ink and paper share them.
   */
  const sweep = (covered: Rect[]): PaintedFill[] => {
    const cell = CELL_PT;
    const cols = Math.floor(width / cell);
    const rows = Math.floor(height / cell);
    if (cols < 2 || rows < 2) return [];

    const colours: Array<string | null> = new Array(cols * rows).fill(null);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rect = {
          x0: c * cell,
          y0: r * cell,
          x1: (c + 1) * cell,
          y1: (r + 1) * cell,
        };
        if (
          covered.some(
            (o) => o.x0 <= rect.x0 + 1 && o.y0 <= rect.y0 + 1 && o.x1 >= rect.x1 - 1 && o.y1 >= rect.y1 - 1
          )
        ) {
          continue;
        }
        const x0 = Math.max(0, Math.round(rect.x0 * sx));
        const y0 = Math.max(0, Math.round(rect.y0 * sy));
        const x1 = Math.min(data.width, Math.round(rect.x1 * sx));
        const y1 = Math.min(data.height, Math.round(rect.y1 * sy));
        if (x1 - x0 < 2 || y1 - y0 < 2) continue;
        const found = cellColour(pixels, stride, x0, y0, x1, y1);
        if (!found || found.share < SOLID_SHARE || isPaper(found.color)) continue;
        colours[r * cols + c] = found.color;
      }
    }

    // Grow each unclaimed cell into the widest run of its colour, then down
    // for as long as the run continues. Each step is compared with its own
    // neighbour rather than with the cell the group started from, so a panel
    // that runs between two colours stays one panel instead of breaking into
    // bands the size of the tolerance.
    const out: PaintedFill[] = [];
    const taken = new Array(cols * rows).fill(false);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const start = colours[r * cols + c];
        if (!start || taken[r * cols + c]) continue;
        let c1 = c;
        while (c1 + 1 < cols && !taken[r * cols + c1 + 1]) {
          const next = colours[r * cols + c1 + 1];
          if (!next || channelGap(next, colours[r * cols + c1]!) > MERGE_DELTA) break;
          c1 += 1;
        }
        let r1 = r;
        for (let next = r + 1; next < rows; next++) {
          let ok = true;
          for (let x = c; x <= c1 && ok; x++) {
            const value = colours[next * cols + x];
            const above = colours[(next - 1) * cols + x];
            ok = !taken[next * cols + x] && !!value && !!above &&
              channelGap(value, above) <= MERGE_DELTA;
          }
          if (!ok) break;
          r1 = next;
        }
        for (let y = r; y <= r1; y++) for (let x = c; x <= c1; x++) taken[y * cols + x] = true;
        const spanX = (c1 - c + 1) * cell;
        const spanY = (r1 - r + 1) * cell;
        if (spanX < MIN_SPAN_PT || spanY < MIN_SPAN_PT || spanX * spanY < MIN_AREA_PT) continue;
        const rect = {
          x0: c * cell,
          y0: r * cell,
          x1: Math.min(width, (c1 + 1) * cell),
          y1: Math.min(height, (r1 + 1) * cell),
        };
        out.push(read(rect, start));
      }
    }
    return out;
  };

  return { read, sweep };
}
