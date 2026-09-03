import type { PDFPageProxy } from "pdfjs-dist";
import { familyFromGeneric, resolveFontName } from "./fonts";
import { canvasToRaster, createCanvas, hasTransparency } from "./raster";
import type {
  FontStyle,
  PageContent,
  PdfFill,
  PdfImage,
  PdfLine,
  PdfRule,
  PdfSpan,
  Rect,
} from "./types";

type Matrix = [number, number, number, number, number, number];
type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/**
 * pdf.js encodes path geometry as a flat number stream. The opcodes are an
 * internal enum (`DrawOPS`) that is not re-exported, so they are mirrored here.
 */
const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUADRATIC_CURVE_TO = 3;
const DRAW_CLOSE_PATH = 4;

/** Anything thinner than this is a rule (table border, underline), not a box. */
const MAX_RULE_THICKNESS = 3.2;
const MIN_RULE_LENGTH = 3;
/** Images and artwork below this size are decoration we can safely drop. */
const MIN_IMAGE_PT = 6;
/** A correctly addressed image arrives in milliseconds; this is only a
 *  guard against one that never will, where a page crop takes over. */
const IMAGE_OBJECT_TIMEOUT_MS = 2500;
/** Designed CVs (Pages, Canva) can spend minutes in pdf.js on one page. */
const OPERATOR_LIST_TIMEOUT_MS = 8000;
const PAGE_RENDER_TIMEOUT_MS = 8000;
/** Above this, clustering tiny marks is more expensive than the pictures are worth. */
const MAX_ARTWORK_MARKS = 2500;
/** A single constructPath from Illustrator/Canva can be hundreds of thousands of numbers. */
const MAX_PATH_STREAM = 4000;
/** After this many operators, skip remaining path decode — images and text still land. */
const MAX_PATH_OPS = 8000;
const SCAN_BUDGET_MS = 1500;
const SCAN_YIELD_EVERY = 200;

function yieldUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function toMatrix(value: unknown): Matrix | null {
  if (!value) return null;
  const src = value as Record<number, number> & { length?: number };
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const n = Number(src[i]);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out as Matrix;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hex(r: number, g: number, b: number): string {
  return (
    clamp255(r).toString(16).padStart(2, "0") +
    clamp255(g).toString(16).padStart(2, "0") +
    clamp255(b).toString(16).padStart(2, "0")
  ).toUpperCase();
}

/** pdf.js hands colours over as "#rrggbb"; normalise to Word's "RRGGBB". */
function normalizeColor(value: unknown): string | undefined {
  if (typeof value === "string") {
    const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    if (m) return m[1].toUpperCase();
    return undefined;
  }
  if (Array.isArray(value) && value.length >= 3) {
    return hex(value[0] * 255, value[1] * 255, value[2] * 255);
  }
  return undefined;
}

type GraphicsState = {
  ctm: Matrix;
  fill: string;
  stroke: string;
  lineWidth: number;
};

type TextState = {
  tm: Matrix;
  tlm: Matrix;
  leading: number;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  rise: number;
};

/**
 * One text-showing operator: where it started, how wide it ran, the fill
 * colour in force, and the characters it drew.
 *
 * `getTextContent` merges consecutive operators into a single item whenever
 * the font does not change, so a sentence that switches colour or picks up an
 * underline arrives as one undifferentiated item. These marks are what let the
 * item be split back into its real runs.
 */
type RunMark = { x: number; y: number; width: number; color: string; text: string };

type ImageDraw = {
  /** Unit-square → device transform for the image placement. */
  matrix: Matrix;
  rect: Rect;
  /** Named XObject, or null when the image is inline / a stencil mask. */
  name: string | null;
  inline: unknown;
  /** Stencil masks are painted in the current fill colour. */
  maskColor?: string;
};

type PathSegment = { x0: number; y0: number; x1: number; y1: number };

/** One painted vector primitive, kept so artwork regions can be recognised. */
type VectorMark = {
  rect: Rect;
  kind: "rule" | "fill" | "complex";
  rule?: PdfRule;
  fill?: PdfFill;
};

type PageScan = {
  runMarks: RunMark[];
  rules: PdfRule[];
  fills: PdfFill[];
  images: ImageDraw[];
  vectors: VectorMark[];
};

function rectFromPoints(points: Array<[number, number]>): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1
  );
}

function unionRect(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** Decode pdf.js' flat path stream into device-space subpaths. */
function decodePath(
  data: ArrayLike<number> | null | undefined,
  toDevice: Matrix
): { subpaths: Array<Array<[number, number]>>; curved: boolean } {
  const subpaths: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let curved = false;
  if (!data) return { subpaths, curved };
  // Designed CVs ship icons as one enormous path. Walking every point freezes
  // the tab on the last page (86% for a 3-page file). Treat it as artwork.
  if (data.length > MAX_PATH_STREAM) {
    return { subpaths, curved: true };
  }

  const push = (x: number, y: number) => current.push(apply(toDevice, x, y));
  const flush = () => {
    if (current.length > 1) subpaths.push(current);
    current = [];
  };

  for (let i = 0; i < data.length; ) {
    switch (data[i++]) {
      case DRAW_MOVE_TO:
        flush();
        push(data[i++], data[i++]);
        break;
      case DRAW_LINE_TO:
        push(data[i++], data[i++]);
        break;
      case DRAW_CURVE_TO:
        curved = true;
        i += 4;
        push(data[i++], data[i++]);
        break;
      case DRAW_QUADRATIC_CURVE_TO:
        curved = true;
        i += 2;
        push(data[i++], data[i++]);
        break;
      case DRAW_CLOSE_PATH: {
        // pdf.js can emit two closePath opcodes for one `re` + `f` pair.
        // Closing an already-closed subpath again would leave a duplicate
        // point, and a rectangle with five corners is no longer a rectangle.
        const last = current[current.length - 1];
        const closed =
          current.length > 1 &&
          Math.abs(last[0] - current[0][0]) < 0.01 &&
          Math.abs(last[1] - current[0][1]) < 0.01;
        if (current.length > 1 && !closed) current.push(current[0]);
        break;
      }
      default:
        // Unknown opcode: the rest of the stream can no longer be trusted.
        i = data.length;
        break;
    }
  }
  flush();
  return { subpaths, curved };
}

function axisAlignedSegments(subpath: Array<[number, number]>): PathSegment[] | null {
  const segments: PathSegment[] = [];
  for (let i = 1; i < subpath.length; i++) {
    const [x0, y0] = subpath[i - 1];
    const [x1, y1] = subpath[i];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    if (dx > 0.6 && dy > 0.6) return null; // diagonal → artwork, not a rule
    segments.push({ x0, y0, x1, y1 });
  }
  return segments;
}

/**
 * A rounded rectangle: four corner arcs joined by axis-aligned sides. Callout
 * boxes and button-like panels are drawn this way, and keeping their fill (as
 * a square-cornered one) is far closer to the original than dropping it.
 */
function isRoundedRectangle(subpath: Array<[number, number]>): boolean {
  if (subpath.length < 8 || subpath.length > 24) return false;
  const rect = rectFromPoints(subpath);
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  if (w < 8 || h < 8) return false;
  const reach = Math.min(w, h) * 0.45;
  const corners: Array<[number, number]> = [
    [rect.x0, rect.y0],
    [rect.x1, rect.y0],
    [rect.x0, rect.y1],
    [rect.x1, rect.y1],
  ];
  return corners.every(([cx, cy]) =>
    subpath.some(([x, y]) => Math.abs(x - cx) <= reach && Math.abs(y - cy) <= reach)
  );
}

function isRectangle(subpath: Array<[number, number]>): boolean {
  const pts = subpath.length > 1 &&
    Math.abs(subpath[0][0] - subpath[subpath.length - 1][0]) < 0.01 &&
    Math.abs(subpath[0][1] - subpath[subpath.length - 1][1]) < 0.01
    ? subpath.slice(0, -1)
    : subpath;
  if (pts.length !== 4) return false;
  return axisAlignedSegments([...pts, pts[0]]) !== null;
}

/**
 * Walk the operator list once and pull out everything the text layer cannot
 * express: fill colours keyed by text origin, ruling lines, background fills,
 * image placements and dense vector artwork.
 */
async function scanOperators(
  page: PDFPageProxy,
  pdfjsLib: PdfJsModule,
  viewportTransform: Matrix
): Promise<PageScan> {
  const scan: PageScan = {
    runMarks: [],
    rules: [],
    fills: [],
    images: [],
    vectors: [],
  };
  const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
  const opList = await withTimeout(
    page.getOperatorList(),
    OPERATOR_LIST_TIMEOUT_MS,
    null as Awaited<ReturnType<PDFPageProxy["getOperatorList"]>> | null
  );
  if (!opList) return scan;

  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  let gs: GraphicsState = { ctm: identity, fill: "000000", stroke: "000000", lineWidth: 1 };
  const gsStack: GraphicsState[] = [];
  let ts: TextState = {
    tm: identity,
    tlm: identity,
    leading: 0,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    rise: 0,
  };

  const deviceScale = (m: Matrix) =>
    Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

  const recordText = (glyphs: unknown) => {
    const trm = mul(mul(viewportTransform, gs.ctm), ts.tm);
    const [x, y] = apply(trm, 0, ts.rise);

    let tx = 0;
    let text = "";
    if (Array.isArray(glyphs)) {
      for (const glyph of glyphs) {
        if (typeof glyph === "number") {
          tx -= (glyph / 1000) * ts.fontSize;
          continue;
        }
        const g = glyph as { width?: number; isSpace?: boolean; unicode?: string } | null;
        if (!g) continue;
        tx +=
          ((g.width ?? 0) / 1000) * ts.fontSize +
          ts.charSpacing +
          (g.isSpace ? ts.wordSpacing : 0);
        text += g.unicode ?? "";
      }
    }

    const advance = tx * ts.hScale;
    const [ex, ey] = apply(trm, advance, ts.rise);
    scan.runMarks.push({ x, y, width: Math.hypot(ex - x, ey - y), color: gs.fill, text });

    // Advance the text matrix so consecutive shows on one line stay aligned.
    if (Array.isArray(glyphs)) ts.tm = mul(ts.tm, [1, 0, 0, 1, advance, 0]);
  };

  const nextLine = () => {
    ts.tlm = mul(ts.tlm, [1, 0, 0, 1, 0, -ts.leading]);
    ts.tm = ts.tlm;
  };

  const moveText = (tx: number, ty: number) => {
    ts.tlm = mul(ts.tlm, [1, 0, 0, 1, tx, ty]);
    ts.tm = ts.tlm;
  };

  const addPath = (drawOp: number, pathData: ArrayLike<number> | null) => {
    const toDevice = mul(viewportTransform, gs.ctm);
    const { subpaths, curved } = decodePath(pathData, toDevice);
    if (subpaths.length === 0) return;

    const stroked =
      drawOp === OPS.stroke ||
      drawOp === OPS.closeStroke ||
      drawOp === OPS.fillStroke ||
      drawOp === OPS.eoFillStroke ||
      drawOp === OPS.closeFillStroke ||
      drawOp === OPS.closeEOFillStroke;
    const filled =
      drawOp === OPS.fill ||
      drawOp === OPS.eoFill ||
      drawOp === OPS.fillStroke ||
      drawOp === OPS.eoFillStroke ||
      drawOp === OPS.closeFillStroke ||
      drawOp === OPS.closeEOFillStroke;
    if (!stroked && !filled) return; // clipping / endPath

    const thickness = Math.max(0.4, gs.lineWidth * deviceScale(gs.ctm));
    let complexity = 0;

    for (const subpath of subpaths) {
      const segments = curved ? null : axisAlignedSegments(subpath);
      if (!segments) {
        if (filled && isRoundedRectangle(subpath)) {
          scan.fills.push({ rect: rectFromPoints(subpath), color: gs.fill });
          continue;
        }
        complexity += 1;
        continue;
      }

      if (filled && isRectangle(subpath)) {
        const rect = rectFromPoints(subpath);
        const w = rect.x1 - rect.x0;
        const h = rect.y1 - rect.y0;
        if (Math.min(w, h) <= MAX_RULE_THICKNESS && Math.max(w, h) >= MIN_RULE_LENGTH) {
          const horizontal = w >= h;
          const rule: PdfRule = {
            horizontal,
            pos: horizontal ? (rect.y0 + rect.y1) / 2 : (rect.x0 + rect.x1) / 2,
            start: horizontal ? rect.x0 : rect.y0,
            end: horizontal ? rect.x1 : rect.y1,
            thickness: Math.max(0.4, Math.min(w, h)),
            color: gs.fill,
          };
          scan.rules.push(rule);
          scan.vectors.push({ rect, kind: "rule", rule });
        } else if (w >= 2 && h >= 2) {
          const fill: PdfFill = { rect, color: gs.fill };
          scan.fills.push(fill);
          scan.vectors.push({ rect, kind: "fill", fill });
        }
        continue;
      }

      if (stroked) {
        for (const seg of segments) {
          const dx = Math.abs(seg.x1 - seg.x0);
          const dy = Math.abs(seg.y1 - seg.y0);
          if (Math.max(dx, dy) < MIN_RULE_LENGTH) continue;
          if (thickness > MAX_RULE_THICKNESS) {
            complexity += 1;
            continue;
          }
          const horizontal = dx >= dy;
          const rule: PdfRule = {
            horizontal,
            pos: horizontal ? (seg.y0 + seg.y1) / 2 : (seg.x0 + seg.x1) / 2,
            start: horizontal ? Math.min(seg.x0, seg.x1) : Math.min(seg.y0, seg.y1),
            end: horizontal ? Math.max(seg.x0, seg.x1) : Math.max(seg.y0, seg.y1),
            thickness,
            color: gs.stroke,
          };
          scan.rules.push(rule);
          scan.vectors.push({
            rect: {
              x0: Math.min(seg.x0, seg.x1),
              y0: Math.min(seg.y0, seg.y1),
              x1: Math.max(seg.x0, seg.x1),
              y1: Math.max(seg.y0, seg.y1),
            },
            kind: "rule",
            rule,
          });
        }
        continue;
      }

      complexity += 1;
    }

    if (complexity > 0) {
      const all = subpaths.flat();
      if (all.length > 0) scan.vectors.push({ rect: rectFromPoints(all), kind: "complex" });
    }
  };

  const addImage = (name: string | null, inline: unknown, maskColor?: string) => {
    const matrix = mul(viewportTransform, gs.ctm);
    const corners: Array<[number, number]> = [
      apply(matrix, 0, 0),
      apply(matrix, 1, 0),
      apply(matrix, 0, 1),
      apply(matrix, 1, 1),
    ];
    const rect = rectFromPoints(corners);
    if (rect.x1 - rect.x0 < MIN_IMAGE_PT || rect.y1 - rect.y0 < MIN_IMAGE_PT) return;
    scan.images.push({ matrix, rect, name, inline, maskColor });
  };

  const startedAt = performance.now();
  let skipPaths = opList.fnArray.length > MAX_PATH_OPS * 2;
  let pathOps = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    if (i > 0 && i % SCAN_YIELD_EVERY === 0) {
      await yieldUi();
      if (!skipPaths && performance.now() - startedAt > SCAN_BUDGET_MS) skipPaths = true;
    }
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];

    switch (fn) {
      case OPS.save:
        gsStack.push({ ...gs });
        break;
      case OPS.restore:
        gs = gsStack.pop() ?? gs;
        break;
      case OPS.transform: {
        const m = toMatrix(args);
        if (m) gs = { ...gs, ctm: mul(gs.ctm, m) };
        break;
      }
      case OPS.setLineWidth:
        gs = { ...gs, lineWidth: Number(args[0]) || 0 };
        break;
      case OPS.setFillRGBColor:
      case OPS.setFillColor:
      case OPS.setFillColorN: {
        const c = normalizeColor(args[0]);
        if (c) gs = { ...gs, fill: c };
        break;
      }
      case OPS.setFillGray: {
        const v = Number(args[0]);
        if (Number.isFinite(v)) gs = { ...gs, fill: hex(v * 255, v * 255, v * 255) };
        break;
      }
      case OPS.setFillCMYKColor: {
        const [c, m, y, k] = (args as number[]).map(Number);
        if ([c, m, y, k].every(Number.isFinite)) {
          gs = {
            ...gs,
            fill: hex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)),
          };
        }
        break;
      }
      case OPS.setStrokeRGBColor:
      case OPS.setStrokeColor:
      case OPS.setStrokeColorN: {
        const c = normalizeColor(args[0]);
        if (c) gs = { ...gs, stroke: c };
        break;
      }
      case OPS.setStrokeGray: {
        const v = Number(args[0]);
        if (Number.isFinite(v)) gs = { ...gs, stroke: hex(v * 255, v * 255, v * 255) };
        break;
      }
      case OPS.beginText:
        ts = { ...ts, tm: identity, tlm: identity };
        break;
      case OPS.setTextMatrix: {
        const m = toMatrix(args[0] ?? args);
        if (m) ts = { ...ts, tm: m, tlm: m };
        break;
      }
      case OPS.setLeading:
        ts = { ...ts, leading: Number(args[0]) || 0 };
        break;
      case OPS.setLeadingMoveText:
        ts = { ...ts, leading: -(Number(args[1]) || 0) };
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.moveText:
        moveText(Number(args[0]) || 0, Number(args[1]) || 0);
        break;
      case OPS.nextLine:
        nextLine();
        break;
      case OPS.setFont:
        ts = { ...ts, fontSize: Number(args[1]) || ts.fontSize };
        break;
      case OPS.setCharSpacing:
        ts = { ...ts, charSpacing: Number(args[0]) || 0 };
        break;
      case OPS.setWordSpacing:
        ts = { ...ts, wordSpacing: Number(args[0]) || 0 };
        break;
      case OPS.setHScale:
        ts = { ...ts, hScale: (Number(args[0]) || 100) / 100 };
        break;
      case OPS.setTextRise:
        ts = { ...ts, rise: Number(args[0]) || 0 };
        break;
      case OPS.showText:
        recordText(args[0]);
        break;
      case OPS.nextLineShowText:
        nextLine();
        recordText(args[0]);
        break;
      case OPS.nextLineSetSpacingShowText:
        ts = {
          ...ts,
          wordSpacing: Number(args[0]) || 0,
          charSpacing: Number(args[1]) || 0,
        };
        nextLine();
        recordText(args[2]);
        break;
      case OPS.constructPath: {
        if (skipPaths || pathOps >= MAX_PATH_OPS) {
          skipPaths = true;
          break;
        }
        pathOps += 1;
        // pdf.js passes the geometry boxed in a one-element array, which it
        // later swaps in place for a Path2D while rendering.
        const boxed = args[1];
        const pathData = (Array.isArray(boxed) ? boxed[0] : boxed) as ArrayLike<number> | null;
        addPath(Number(args[0]), pathData);
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintImageXObjectRepeat:
        if (typeof args[0] === "string") addImage(args[0], null);
        break;
      case OPS.paintInlineImageXObject:
        addImage(null, args[0]);
        break;
      case OPS.paintImageMaskXObject:
      case OPS.paintImageMaskXObjectGroup:
      case OPS.paintImageMaskXObjectRepeat:
        addImage(null, null, gs.fill);
        break;
      case OPS.shadingFill: {
        // Gradients cannot be represented in the text flow — treat as artwork.
        const m = mul(viewportTransform, gs.ctm);
        const corners: Array<[number, number]> = [
          apply(m, 0, 0),
          apply(m, 1, 0),
          apply(m, 0, 1),
          apply(m, 1, 1),
        ];
        scan.vectors.push({ rect: rectFromPoints(corners), kind: "complex" });
        break;
      }
      default:
        break;
    }
  }

  return scan;
}

/**
 * Resolve a named image XObject. pdf.js delivers these asynchronously, and an
 * image used on more than one page is promoted to the document-wide store
 * under a "g_" prefixed name — looking only at the page's own store would wait
 * out the timeout on every repeat of a logo or a letterhead.
 */
function getImageObject(page: PDFPageProxy, name: string): Promise<unknown> {
  type ObjectStore = {
    has(id: string): boolean;
    get(id: string, cb?: (value: unknown) => void): unknown;
  };
  const store = (
    name.startsWith("g_") ? page.commonObjs : page.objs
  ) as unknown as ObjectStore;

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(value ?? null);
    };
    const timer = setTimeout(() => done(null), IMAGE_OBJECT_TIMEOUT_MS);
    try {
      if (store.has(name)) {
        clearTimeout(timer);
        done(store.get(name));
        return;
      }
      store.get(name, (value) => {
        clearTimeout(timer);
        done(value);
      });
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

type DecodedBitmap = { source: CanvasImageSource; width: number; height: number };

/** Turn a pdf.js image object into something drawable on a canvas. */
function decodeBitmap(obj: unknown): DecodedBitmap | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as {
    bitmap?: ImageBitmap;
    data?: Uint8Array | Uint8ClampedArray;
    width?: number;
    height?: number;
    kind?: number;
  };

  if (rec.bitmap) {
    return { source: rec.bitmap, width: rec.bitmap.width, height: rec.bitmap.height };
  }
  if (!rec.data || !rec.width || !rec.height) return null;

  const { width, height } = rec;
  if (width * height > 4_000_000) return null;
  const src = rec.data;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const pixels = width * height;

  if (rec.kind === 3 && src.length >= pixels * 4) {
    rgba.set(src.subarray(0, rgba.length));
  } else if (rec.kind === 2 && src.length >= pixels * 3) {
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      rgba[i * 4] = src[j];
      rgba[i * 4 + 1] = src[j + 1];
      rgba[i * 4 + 2] = src[j + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else if (rec.kind === 1) {
    // 1 bit per pixel, rows padded to whole bytes.
    const rowBytes = (width + 7) >> 3;
    if (src.length < rowBytes * height) return null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = src[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7));
        const v = bit ? 255 : 0;
        const i = (y * width + x) * 4;
        rgba[i] = v;
        rgba[i + 1] = v;
        rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
  } else {
    return null;
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return { source: canvas, width, height };
}

/**
 * Draw a decoded bitmap into its device-space rectangle, honouring the flip
 * and rotation carried by the placement matrix. PDF images live on the unit
 * square with the first pixel row at the top (v = 1), which is why the source
 * is pre-multiplied by [1/w, 0, 0, -1/h, 0, 1].
 */
async function rasterizePlacedImage(
  bitmap: DecodedBitmap,
  matrix: Matrix,
  rect: Rect
): Promise<PdfImage | null> {
  const boxWidth = rect.x1 - rect.x0;
  const boxHeight = rect.y1 - rect.y0;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const scale = Math.min(
    6,
    Math.max(1, Math.min(bitmap.width / boxWidth, bitmap.height / boxHeight) || 1)
  );
  const canvas = createCanvas(boxWidth * scale, boxHeight * scale);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;

  const toBox = mul([scale, 0, 0, scale, -rect.x0 * scale, -rect.y0 * scale], matrix);
  const full = mul(toBox, [1 / bitmap.width, 0, 0, -1 / bitmap.height, 0, 1]);
  ctx.save();
  ctx.setTransform(full[0], full[1], full[2], full[3], full[4], full[5]);
  try {
    ctx.drawImage(bitmap.source, 0, 0);
  } catch {
    ctx.restore();
    return null;
  }
  ctx.restore();

  let transparent = true;
  try {
    if (canvas.width * canvas.height <= 2_000_000) {
      transparent = hasTransparency(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    }
  } catch {
    transparent = true;
  }
  const raster = await canvasToRaster(canvas, !transparent && canvas.width * canvas.height > 90000);
  return raster ? { rect, data: raster.data, type: raster.type } : null;
}

/** Lazily renders the page once so regions can be cropped out of it. */
class PageRenderCache {
  private promise: Promise<{ canvas: HTMLCanvasElement; scale: number } | null> | null = null;

  constructor(
    private readonly page: PDFPageProxy,
    private readonly scale: number
  ) {}

  get(): Promise<{ canvas: HTMLCanvasElement; scale: number } | null> {
    if (!this.promise) {
      this.promise = this.render().catch(() => null);
    }
    return this.promise;
  }

  private async render() {
    const viewport = this.page.getViewport({ scale: this.scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const task = this.page.render({
      canvas,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      background: "#ffffff",
    } as Parameters<PDFPageProxy["render"]>[0]);
    const finished = await withTimeout(
      task.promise.then(() => true as const),
      PAGE_RENDER_TIMEOUT_MS,
      false as const
    );
    if (!finished) {
      try {
        task.cancel();
      } catch {
        // pdf.js may already have torn the task down.
      }
      return null;
    }
    return { canvas, scale: this.scale };
  }
}

async function cropFromPage(
  cache: PageRenderCache,
  rect: Rect,
  pageWidth: number,
  pageHeight: number
): Promise<PdfImage | null> {
  const rendered = await cache.get();
  if (!rendered) return null;
  const { canvas: source, scale } = rendered;

  const x0 = Math.max(0, Math.floor(rect.x0 * scale));
  const y0 = Math.max(0, Math.floor(rect.y0 * scale));
  const x1 = Math.min(source.width, Math.ceil(rect.x1 * scale));
  const y1 = Math.min(source.height, Math.ceil(rect.y1 * scale));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return null;

  const canvas = createCanvas(w, h);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;
  ctx.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  const raster = await canvasToRaster(canvas, w * h > 90000);
  if (!raster) return null;
  return {
    rect: {
      x0: Math.max(0, Math.min(pageWidth, x0 / scale)),
      y0: Math.max(0, Math.min(pageHeight, y0 / scale)),
      x1: Math.max(0, Math.min(pageWidth, x1 / scale)),
      y1: Math.max(0, Math.min(pageHeight, y1 / scale)),
    },
    data: raster.data,
    type: raster.type,
  };
}

/**
 * Decide which parts of the page are artwork — charts, diagrams, logos — and
 * therefore have to be rasterised rather than rebuilt.
 *
 * The test is density plus shape. A cluster of many vector primitives is
 * artwork unless its rules form a lattice, which is what a ruled table looks
 * like; tables are rebuilt as real Word tables and must never be flattened
 * into a picture. Single rules (underlines, a line under a running head) and
 * lone fills (a heading band) stay as formatting.
 */
function findArtworkRegions(
  vectors: VectorMark[],
  spans: PdfSpan[],
  pageWidth: number,
  pageHeight: number
): Array<{ rect: Rect; members: VectorMark[] }> {
  const usable = vectors.filter(
    (v) =>
      Number.isFinite(v.rect.x0) &&
      Number.isFinite(v.rect.y0) &&
      v.rect.x1 > 0 &&
      v.rect.y1 > 0 &&
      v.rect.x0 < pageWidth &&
      v.rect.y0 < pageHeight
  );
  if (usable.length === 0) return [];

  // Designed résumés emit thousands of icon paths and skill-bar fills. The
  // previous restart-on-merge loop was cubic in the cluster count and froze
  // the tab on the last page — 86% for a one-page CV.
  const marks =
    usable.length > MAX_ARTWORK_MARKS
      ? usable.filter((v) => {
          const w = v.rect.x1 - v.rect.x0;
          const h = v.rect.y1 - v.rect.y0;
          return v.kind === "complex" || w * h >= 400;
        })
      : usable;
  if (marks.length === 0) return [];

  const n = marks.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (index: number): number => {
    let i = index;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const pad = 10;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => marks[a].rect.x0 - marks[b].rect.x0
  );
  for (let a = 0; a < n; a++) {
    const i = order[a];
    const ri = marks[i].rect;
    const xLimit = ri.x1 + pad;
    for (let b = a + 1; b < n; b++) {
      const j = order[b];
      if (marks[j].rect.x0 > xLimit) break;
      if (rectsOverlap(ri, marks[j].rect, pad)) union(i, j);
    }
  }

  const clusters = new Map<number, { rect: Rect; members: VectorMark[] }>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const hit = clusters.get(root);
    if (hit) {
      hit.rect = unionRect(hit.rect, marks[i].rect);
      hit.members.push(marks[i]);
    } else {
      clusters.set(root, { rect: { ...marks[i].rect }, members: [marks[i]] });
    }
  }

  return [...clusters.values()]
    .filter((cluster) => {
      const w = cluster.rect.x1 - cluster.rect.x0;
      const h = cluster.rect.y1 - cluster.rect.y0;
      if (w < 24 || h < 24) return false;
      if (w >= pageWidth * 0.97 && h >= pageHeight * 0.97) return false;
      // A designed CV's sidebar is a page-tall coloured band with a photo and
      // skill bars on it, and those bars read exactly like a bar chart. It is
      // a layout device, not a picture: flattening it costs the name, the job
      // title and every skill their text. A band is recognised by one member
      // covering most of the cluster while the cluster runs the length of the
      // page — a real chart is built from parts, none of which fills it.
      const area = Math.max(1, w * h);
      const dominated = cluster.members.some(
        (m) => (m.rect.x1 - m.rect.x0) * (m.rect.y1 - m.rect.y0) >= area * 0.6
      );
      if (dominated && (h >= pageHeight * 0.7 || w >= pageWidth * 0.7)) return false;
      // Curves or diagonals mean a drawing: a pie, a diagram, a gradient.
      const curved = cluster.members.some((m) => m.kind === "complex");
      if (curved && cluster.members.length >= 2) return true;
      // Otherwise only a plot built from bars qualifies. Ruled tables and
      // boxed form fields are made of the same primitives and must stay text.
      if (cluster.members.length < 8) return false;
      return !looksLikeGrid(cluster.members, cluster.rect) && looksLikeBarChart(cluster.members);
    })
    .map((cluster) => ({
      rect: clampRect(absorbLabels(cluster.rect, spans), pageWidth, pageHeight),
      members: cluster.members,
    }));
}

/**
 * Grow an artwork region to take in the text drawn on and around it — axis
 * ticks, slice labels, a legend. Those glyphs belong to the picture; leaving
 * them in the flow would scatter stray one-word paragraphs down the page.
 */
function absorbLabels(rect: Rect, spans: PdfSpan[]): Rect {
  const pad = Math.max(8, median(spans.map((s) => s.fontSize)) ?? 8);
  let current = rect;
  for (let pass = 0; pass < 3; pass++) {
    const padded = {
      x0: current.x0 - pad,
      y0: current.y0 - pad,
      x1: current.x1 + pad,
      y1: current.y1 + pad,
    };
    let grown = current;
    for (const span of spans) {
      if (!span.text.trim()) continue;
      const box = { x0: span.x, y0: span.yTop, x1: span.xEnd, y1: span.yBottom };
      if (!rectsOverlap(padded, box)) continue;
      // Only short labels are absorbed; a paragraph beside a figure is not.
      if (span.xEnd - span.x > (current.x1 - current.x0) * 0.9) continue;
      grown = unionRect(grown, box);
    }
    if (
      grown.x0 === current.x0 &&
      grown.y0 === current.y0 &&
      grown.x1 === current.x1 &&
      grown.y1 === current.y1
    ) {
      break;
    }
    current = grown;
  }
  return current;
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  return {
    x0: Math.max(0, rect.x0),
    y0: Math.max(0, rect.y0),
    x1: Math.min(width, rect.x1),
    y1: Math.min(height, rect.y1),
  };
}

/**
 * Filled blocks of varying size, the shape of a bar or column chart. Zebra
 * table stripes are also filled rectangles, but they repeat at one size, and
 * an empty box on a form is stroked rather than filled.
 */
function looksLikeBarChart(members: VectorMark[]): boolean {
  const fills = members.filter((m) => m.kind === "fill");
  if (fills.length < 4) return false;
  const distinct = (values: number[]) => new Set(values.map((v) => Math.round(v / 2))).size;
  const widths = fills.map((f) => f.rect.x1 - f.rect.x0);
  const heights = fills.map((f) => f.rect.y1 - f.rect.y0);
  return distinct(widths) >= 3 || distinct(heights) >= 3;
}

/**
 * A lattice: long parallel rules repeated at the same extent — a ruled table.
 * Only rules that run most of the way across the cluster count, so a chart's
 * axis ticks (short, regular, repeated) are not mistaken for table rules.
 */
function looksLikeGrid(members: VectorMark[], rect: Rect): boolean {
  const width = rect.x1 - rect.x0;
  const height = rect.y1 - rect.y0;
  const repeated = (rules: PdfRule[]) => {
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        if (
          Math.abs(rules[i].start - rules[j].start) <= 3 &&
          Math.abs(rules[i].end - rules[j].end) <= 3 &&
          Math.abs(rules[i].pos - rules[j].pos) > 3
        ) {
          return true;
        }
      }
    }
    return false;
  };
  const rules = members.map((m) => m.rule).filter((r): r is PdfRule => Boolean(r));
  if (rules.length > 80) return false;
  const long = (r: PdfRule) =>
    r.end - r.start >= (r.horizontal ? width : height) * 0.6;
  return (
    repeated(rules.filter((r) => r.horizontal && long(r))) &&
    repeated(rules.filter((r) => !r.horizontal && long(r)))
  );
}

/**
 * Spatial index over the show-text operators, so a text item can be matched
 * back to the operators that drew it.
 */
class RunIndex {
  private readonly byRow = new Map<number, RunMark[]>();

  constructor(marks: RunMark[]) {
    for (const mark of marks) {
      const key = Math.round(mark.y);
      for (const row of [key - 1, key, key + 1]) {
        const list = this.byRow.get(row);
        if (list) list.push(mark);
        else this.byRow.set(row, [mark]);
      }
    }
    for (const list of this.byRow.values()) list.sort((a, b) => a.x - b.x);
  }

  /** Operators that drew inside [x, x + width] on the baseline through y. */
  covering(x: number, y: number, width: number): RunMark[] {
    const list = this.byRow.get(Math.round(y));
    if (!list) return [];
    return list.filter((mark) => mark.x >= x - 1.5 && mark.x <= x + width + 1.5);
  }
}

/**
 * Split a merged text item back into the runs that drew it.
 *
 * The operators' own characters are used when they add up to the item's text;
 * otherwise the split falls back to the operators' x positions, which still
 * separates a colour or underline change at roughly the right character.
 */
function splitItemRuns(
  text: string,
  x: number,
  width: number,
  marks: RunMark[]
): Array<{ text: string; x: number; width: number; color: string }> {
  const single = [{ text, x, width, color: marks[0]?.color ?? "000000" }];
  if (marks.length < 2) return single;

  const joined = marks.map((m) => m.text).join("");
  if (joined === text) {
    const parts: Array<{ text: string; x: number; width: number; color: string }> = [];
    let cursor = 0;
    for (const mark of marks) {
      if (mark.text.length === 0) continue;
      parts.push({
        text: text.slice(cursor, cursor + mark.text.length),
        x: mark.x,
        width: mark.width,
        color: mark.color,
      });
      cursor += mark.text.length;
    }
    return parts.length > 0 ? parts : single;
  }

  if (width <= 0) return single;
  const parts: Array<{ text: string; x: number; width: number; color: string }> = [];
  let cursor = 0;
  for (let i = 0; i < marks.length; i++) {
    const next = marks[i + 1];
    const endRatio = next ? (next.x - x) / width : 1;
    const end = i === marks.length - 1 ? text.length : Math.round(endRatio * text.length);
    if (end <= cursor) continue;
    parts.push({
      text: text.slice(cursor, end),
      x: marks[i].x,
      width: (next ? next.x : x + width) - marks[i].x,
      color: marks[i].color,
    });
    cursor = end;
  }
  if (cursor < text.length && parts.length > 0) {
    parts[parts.length - 1].text += text.slice(cursor);
  }
  return parts.length > 0 ? parts : single;
}

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
};

function isTextItem(item: unknown): item is TextItem {
  return Boolean(
    item &&
      typeof item === "object" &&
      typeof (item as TextItem).str === "string" &&
      Array.isArray((item as TextItem).transform)
  );
}

type ResolvedFont = FontStyle & { monospace: boolean };

function readFonts(
  page: PDFPageProxy,
  styles: Record<string, { fontFamily?: string; ascent?: number; descent?: number }>
): Map<string, ResolvedFont> {
  const fonts = new Map<string, ResolvedFont>();
  const commonObjs = page.commonObjs as unknown as {
    has(id: string): boolean;
    get(id: string): unknown;
  };

  for (const [id, style] of Object.entries(styles ?? {})) {
    let name = "";
    let bold: boolean | undefined;
    let italic: boolean | undefined;
    let ascent = style?.ascent;
    let descent = style?.descent;

    try {
      if (commonObjs.has(id)) {
        const font = commonObjs.get(id) as {
          name?: string;
          bold?: boolean;
          italic?: boolean;
          black?: boolean;
          ascent?: number;
          descent?: number;
        };
        name = font?.name ?? "";
        bold = Boolean(font?.bold || font?.black);
        italic = Boolean(font?.italic);
        if (typeof font?.ascent === "number") ascent = font.ascent;
        if (typeof font?.descent === "number") descent = font.descent;
      }
    } catch {
      // Font object unavailable — fall back to the generic CSS family.
    }

    const resolved = name
      ? resolveFontName(name)
      : { family: familyFromGeneric(style?.fontFamily), bold: false, italic: false, monospace: false };

    fonts.set(id, {
      family: resolved.family,
      bold: bold ?? resolved.bold,
      italic: italic ?? resolved.italic,
      monospace: resolved.monospace,
      ascent: typeof ascent === "number" && ascent > 0 ? ascent : 0.75,
      descent: typeof descent === "number" && descent < 0 ? descent : -0.22,
    });
  }

  return fonts;
}

function buildLines(spans: PdfSpan[]): PdfLine[] {
  if (spans.length === 0) return [];

  const sorted = [...spans].sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const lines: PdfLine[] = [];
  // Each open line remembers the baseline of its largest run, so a leading
  // superscript cannot drag the line's reference off the real baseline.
  const refs: Array<{ baseline: number; size: number }> = [];

  for (const span of sorted) {
    const last = lines[lines.length - 1];
    const ref = refs[refs.length - 1];
    const small = ref ? Math.min(span.fontSize, ref.size) : span.fontSize;
    const large = ref ? Math.max(span.fontSize, ref.size) : span.fontSize;
    // Same line when the baselines nearly coincide. A run much smaller than
    // the line is a superscript or subscript sitting off the baseline on
    // purpose, so it is allowed a wider tolerance; otherwise the smaller size
    // is used so a drop cap cannot swallow the line beneath it.
    const tolerance =
      small / large < 0.85 ? Math.max(2, large * 0.5) : Math.max(1.6, small * 0.3);

    if (last && ref && Math.abs(span.baseline - ref.baseline) <= tolerance) {
      last.spans.push(span);
      last.x = Math.min(last.x, span.x);
      last.xEnd = Math.max(last.xEnd, span.xEnd);
      last.yTop = Math.min(last.yTop, span.yTop);
      last.yBottom = Math.max(last.yBottom, span.yBottom);
      if (span.text.trim() && span.fontSize > ref.size) {
        ref.size = span.fontSize;
        ref.baseline = span.baseline;
      }
      continue;
    }
    lines.push({
      spans: [span],
      x: span.x,
      xEnd: span.xEnd,
      yTop: span.yTop,
      yBottom: span.yBottom,
      baseline: span.baseline,
      fontSize: span.fontSize,
    });
    refs.push({ baseline: span.baseline, size: span.fontSize });
  }

  for (const line of lines) {
    line.spans.sort((a, b) => a.x - b.x);
    // The dominant size is the one covering the most characters, so a trailing
    // footnote marker cannot redefine the line.
    const weights = new Map<number, number>();
    for (const span of line.spans) {
      const key = Math.round(span.fontSize * 2) / 2;
      weights.set(key, (weights.get(key) ?? 0) + span.text.trim().length + 1);
    }
    let bestSize = line.fontSize;
    let bestWeight = -1;
    for (const [size, weight] of weights) {
      if (weight > bestWeight) {
        bestWeight = weight;
        bestSize = size;
      }
    }
    line.fontSize = bestSize;
    const dominant = line.spans.filter(
      (s) => s.text.trim() && Math.abs(s.fontSize - bestSize) < 0.6
    );
    line.baseline =
      median((dominant.length > 0 ? dominant : line.spans).map((s) => s.baseline)) ?? line.baseline;
  }

  return lines.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Flag runs that sit under a rule as underlined, or through one as struck. */
function applyRules(lines: PdfLine[], rules: PdfRule[]): void {
  let horizontal = rules.filter((r) => r.horizontal && r.thickness <= 2);
  if (horizontal.length === 0) return;
  if (horizontal.length > 400) {
    horizontal = horizontal.filter((r) => r.end - r.start > 12).slice(0, 400);
  }

  for (const line of lines) {
    for (const span of line.spans) {
      if (!span.text.trim()) continue;
      const width = span.xEnd - span.x;
      if (width <= 0) continue;
      for (const rule of horizontal) {
        const overlap = Math.min(span.xEnd, rule.end) - Math.max(span.x, rule.start);
        if (overlap < width * 0.6) continue;
        const offset = rule.pos - span.baseline;
        if (offset > 0.02 * span.fontSize && offset < 0.26 * span.fontSize) {
          span.underline = true;
        } else if (offset < -0.15 * span.fontSize && offset > -0.45 * span.fontSize) {
          span.strike = true;
        }
      }
    }
  }
}

/** Attach a background fill to lines that sit inside one. */
export function applyFills(lines: PdfLine[], fills: PdfFill[]): void {
  if (fills.length === 0) return;
  const area = (f: PdfFill) => (f.rect.x1 - f.rect.x0) * (f.rect.y1 - f.rect.y0);
  const sorted = [...fills].sort((a, b) => area(a) - area(b));
  for (const line of lines) {
    for (const fill of sorted) {
      const r = fill.rect;
      if (
        line.x >= r.x0 - 2 &&
        line.xEnd <= r.x1 + 2 &&
        line.yTop >= r.y0 - 2 &&
        line.yBottom <= r.y1 + 2 &&
        fill.color !== "FFFFFF"
      ) {
        line.shading = fill.color;
        break;
      }
    }
  }
}

function applyLinks(
  lines: PdfLine[],
  links: Array<{ rect: Rect; url: string }>
): void {
  if (links.length === 0) return;
  for (const line of lines) {
    for (const span of line.spans) {
      if (!span.text.trim()) continue;
      const cx = (span.x + span.xEnd) / 2;
      const cy = span.baseline - span.fontSize * 0.3;
      const hit = links.find(
        (l) => cx >= l.rect.x0 - 1 && cx <= l.rect.x1 + 1 && cy >= l.rect.y0 - 1 && cy <= l.rect.y1 + 1
      );
      if (hit) span.link = hit.url;
    }
  }
}

/** Mark runs that sit off the line's baseline as super/subscript. */
function applyScripts(lines: PdfLine[]): void {
  for (const line of lines) {
    for (const span of line.spans) {
      if (!span.text.trim()) continue;
      if (span.fontSize >= line.fontSize * 0.86) continue;
      const offset = line.baseline - span.baseline;
      if (offset > line.fontSize * 0.14) span.vertAlign = "super";
      else if (offset < -line.fontSize * 0.1) span.vertAlign = "sub";
    }
  }
}

async function collectLinks(page: PDFPageProxy, viewportTransform: Matrix) {
  try {
    const annotations = (await page.getAnnotations({ intent: "display" })) as Array<{
      subtype?: string;
      url?: string;
      rect?: number[];
    }>;
    const links: Array<{ rect: Rect; url: string }> = [];
    for (const a of annotations) {
      if (a.subtype !== "Link" || !a.url || !a.rect || a.rect.length < 4) continue;
      const [x0, y0] = apply(viewportTransform, a.rect[0], a.rect[1]);
      const [x1, y1] = apply(viewportTransform, a.rect[2], a.rect[3]);
      links.push({
        rect: {
          x0: Math.min(x0, x1),
          y0: Math.min(y0, y1),
          x1: Math.max(x0, x1),
          y1: Math.max(y0, y1),
        },
        url: a.url,
      });
    }
    return links;
  } catch {
    return [];
  }
}

/**
 * Quarter-turn the page's text is set at, relative to the page as displayed.
 *
 * Pages whose text runs sideways are common — a landscape table saved into a
 * portrait document, a scan fed in the wrong way round. Turning the Word page
 * to match keeps the text editable, which beats falling back to a picture.
 */
function dominantTextRotation(spans: PdfSpan[]): number {
  const weights = new Map<number, number>();
  for (const span of spans) {
    const chars = span.text.trim().length;
    if (chars === 0) continue;
    const quarter = ((Math.round(span.angle / 90) * 90) % 360 + 360) % 360;
    weights.set(quarter, (weights.get(quarter) ?? 0) + chars);
  }
  let best = 0;
  let bestWeight = 0;
  let total = 0;
  for (const [quarter, weight] of weights) {
    total += weight;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = quarter;
    }
  }
  return total > 0 && bestWeight / total >= 0.8 ? best : 0;
}

/**
 * Rasters already produced for a named image XObject at a given size. A logo
 * or letterhead repeated on every page is encoded once for the whole document
 * instead of once per placement.
 */
export type ImageRasterCache = Map<string, { data: Uint8Array; type: "png" | "jpg" } | null>;

export function createImageRasterCache(): ImageRasterCache {
  return new Map();
}

export async function extractPage(
  page: PDFPageProxy,
  pdfjsLib: PdfJsModule,
  pageNumber: number,
  rasterCache: ImageRasterCache = new Map(),
  rotationOverride?: number
): Promise<PageContent> {
  const viewport =
    rotationOverride === undefined
      ? page.getViewport({ scale: 1 })
      : page.getViewport({ scale: 1, rotation: rotationOverride });
  const width = viewport.width;
  const height = viewport.height;
  const viewportTransform = (viewport.transform as number[]).slice(0, 6) as Matrix;

  // The operator scan has to run first: it is what makes the real font objects
  // and the image XObjects available on the page proxy.
  const scan = await scanOperators(page, pdfjsLib, viewportTransform);
  await yieldUi();
  const content = await page.getTextContent();
  const styles = (content.styles ?? {}) as Record<
    string,
    { fontFamily?: string; ascent?: number; descent?: number }
  >;
  const fonts = readFonts(page, styles);
  const runs = new RunIndex(scan.runMarks);

  const spans: PdfSpan[] = [];
  for (const raw of content.items) {
    if (!isTextItem(raw) || !raw.str) continue;
    const text = raw.str;
    if (!text) continue;

    const m = mul(viewportTransform, raw.transform.slice(0, 6) as Matrix);
    const fontSize = Math.hypot(m[2], m[3]) || Math.abs(m[3]) || raw.height || 11;
    if (fontSize <= 0) continue;
    const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;

    const font = fonts.get(raw.fontName) ?? {
      family: "Arial",
      bold: false,
      italic: false,
      monospace: false,
      ascent: 0.75,
      descent: -0.22,
    };

    const x = m[4];
    const baseline = m[5];
    const advance = raw.width || fontSize * text.length * 0.5;
    const style = {
      family: font.family,
      bold: font.bold,
      italic: font.italic,
      ascent: font.ascent,
      descent: font.descent,
    };

    for (const part of splitItemRuns(text, x, advance, runs.covering(x, baseline, advance))) {
      spans.push({
        text: part.text,
        x: part.x,
        xEnd: part.x + part.width,
        baseline,
        yTop: baseline - font.ascent * fontSize,
        yBottom: baseline - font.descent * fontSize,
        fontSize,
        font: style,
        color: part.color === "000000" ? undefined : part.color,
        angle,
        spaceWidth: fontSize * (font.monospace ? 0.6 : 0.28),
      });
    }
  }

  if (rotationOverride === undefined) {
    const turn = dominantTextRotation(spans);
    if (turn !== 0) {
      return extractPage(
        page,
        pdfjsLib,
        pageNumber,
        rasterCache,
        (((page.rotate - turn) % 360) + 360) % 360
      );
    }
  }

  const flowSpans = spans.filter((s) => Math.abs(s.angle) < 4);


  // Rasterise images and vector artwork. A page render is only produced when
  // something actually needs cropping out of it.
  const renderCache = new PageRenderCache(page, 2);
  const images: PdfImage[] = [];
  for (const draw of scan.images) {
    const drawWidth = draw.rect.x1 - draw.rect.x0;
    const drawHeight = draw.rect.y1 - draw.rect.y0;
    const cacheKey = draw.name
      ? `${draw.name}:${Math.round(drawWidth)}x${Math.round(drawHeight)}:${Math.round(
          Math.atan2(draw.matrix[1], draw.matrix[0]) * 100
        )}`
      : null;

    let placed: PdfImage | null = null;
    if (cacheKey && rasterCache.has(cacheKey)) {
      const cached = rasterCache.get(cacheKey);
      if (cached) placed = { rect: draw.rect, data: cached.data, type: cached.type };
    } else {
      const source = draw.name ? await getImageObject(page, draw.name) : draw.inline;
      const bitmap = decodeBitmap(source);
      if (bitmap) placed = await rasterizePlacedImage(bitmap, draw.matrix, draw.rect);
      if (cacheKey) {
        rasterCache.set(cacheKey, placed ? { data: placed.data, type: placed.type } : null);
      }
    }

    if (!placed) {
      placed = await cropFromPage(renderCache, draw.rect, width, height);
    }
    if (placed) images.push(placed);
    if (images.length % 3 === 0) await yieldUi();
  }

  await yieldUi();
  const artwork: PdfImage[] = [];
  const imageRects = images.map((i) => i.rect);
  const consumed = new Set<VectorMark>();
  for (const region of findArtworkRegions(scan.vectors, flowSpans, width, height)) {
    if (imageRects.some((r) => covers(r, region.rect))) continue;
    const cropped = await cropFromPage(renderCache, region.rect, width, height);
    if (!cropped) continue;
    artwork.push(cropped);
    for (const member of region.members) consumed.add(member);
  }

  // Primitives that became part of a picture must not also be read as borders
  // or shading, or the same ink would appear twice.
  const usedRules = new Set(
    [...consumed].map((m) => m.rule).filter((r): r is PdfRule => Boolean(r))
  );
  const usedFills = new Set(
    [...consumed].map((m) => m.fill).filter((f): f is PdfFill => Boolean(f))
  );

  // Glyphs drawn inside a picture belong to it, so they leave the text flow.
  const artworkRects = artwork.map((a) => a.rect);
  const bodySpans = flowSpans.filter(
    (span) =>
      !artworkRects.some(
        (r) => span.x >= r.x0 - 1 && span.xEnd <= r.x1 + 1 && span.yTop >= r.y0 - 1 && span.yBottom <= r.y1 + 1
      )
  );
  const lines = buildLines(bodySpans);
  const textChars = flowSpans.reduce((sum, s) => sum + s.text.trim().length, 0);

  // Formatting is read from what survives: a rule inside a chart is part of
  // the picture, not an underline.
  const rules = scan.rules.filter((r) => !usedRules.has(r));
  const fills = scan.fills.filter((f) => !usedFills.has(f));
  applyRules(lines, rules);
  applyFills(lines, fills);
  applyScripts(lines);
  applyLinks(lines, await collectLinks(page, viewportTransform));

  return { pageNumber, width, height, lines, images, rules, fills, artwork, textChars };
}

function covers(outer: Rect, inner: Rect): boolean {
  return (
    outer.x0 <= inner.x0 + 2 &&
    outer.y0 <= inner.y0 + 2 &&
    outer.x1 >= inner.x1 - 2 &&
    outer.y1 >= inner.y1 - 2
  );
}

/** Render a whole page as a single picture — the scanned-document fallback. */
export async function renderPageBitmap(
  page: PDFPageProxy,
  width: number,
  height: number
): Promise<PdfImage | null> {
  const cache = new PageRenderCache(page, 2);
  return cropFromPage(cache, { x0: 0, y0: 0, x1: width, y1: height }, width, height);
}
