import { applyFills } from "./pdf-extract";
import type { PageContent, PdfFill, PdfImage, PdfLine, PdfRule, PdfSpan, Rect } from "./types";

/**
 * Turns the geometric page model into a document tree Word can express:
 * header/footer bands, columns, paragraphs, tables and placed pictures.
 */

export type TextSegment = {
  spans: PdfSpan[];
  /** Left edge of the segment, used to place the tab stop that precedes it. */
  x: number;
  xEnd: number;
};

export type ParagraphBox = {
  kind: "paragraph";
  lines: PdfLine[];
  /** Text split at wide internal gaps; >1 entry means tab stops are needed. */
  segments: TextSegment[][];
  rect: Rect;
  /** Left/right edges of the block the paragraph belongs to. */
  blockLeft: number;
  blockRight: number;
  align: "left" | "center" | "right" | "justify";
  firstLineIndent: number;
  hangingIndent: number;
  /** Leading measured between the paragraph's own lines. */
  leading: number;
  fontSize: number;
  spaceBefore: number;
  listMarker?: string;
  headingLevel?: number;
  shading?: string;
};

export type TableCellBox = {
  content: Box[];
  /** The cell's own box; paragraph indents are measured against it. */
  rect: Rect;
  columnSpan: number;
  rowSpan: number;
  /** Where the content sits inside the cell. */
  verticalAlign: "top" | "center" | "bottom";
  shading?: string;
  borders: { top: boolean; bottom: boolean; left: boolean; right: boolean };
};

export type TableBox = {
  kind: "table";
  rows: TableCellBox[][];
  columnWidths: number[];
  /** Source height of each row, so the table keeps its vertical rhythm. */
  rowHeights: number[];
  rect: Rect;
  spaceBefore: number;
  bordered: boolean;
};

export type ImageBox = {
  kind: "image";
  image: PdfImage;
  spaceBefore: number;
};

export type ColumnsBox = {
  kind: "columns";
  columns: Box[][];
  widths: number[];
  rect: Rect;
  spaceBefore: number;
};

export type SpacerBox = { kind: "spacer"; height: number };

export type Box = ParagraphBox | TableBox | ImageBox | ColumnsBox | SpacerBox;

export type PageLayout = {
  pageNumber: number;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /** Where this page's content actually starts, before margins are unified. */
  contentTop: number;
  headerDistance: number;
  footerDistance: number;
  header: Box[];
  footer: Box[];
  body: Box[];
  scanned: boolean;
};

const MIN_GUTTER = 16;
const PAGE_REFERENCE =
  /^(?:\d{1,4}|[ivxlcdm]{1,9})(?:\s*[,–—-]\s*(?:\d{1,4}|[ivxlcdm]{1,9}))*$/i;
const TOC_TAB = String.fromCharCode(8);

function lineHasPageReference(line: PdfLine): boolean {
  const segments = splitSegments(line);
  if (segments.length < 2) return false;
  const last = segments[segments.length - 1].spans
    .map((span) => span.text)
    .join("")
    .split(TOC_TAB)
    .join("")
    .trim();
  return PAGE_REFERENCE.test(last);
}
const MAX_MARGIN = 200;
export const LIST_MARKER =
  /^(?:[•▪◦‣∙·●○■□–—*-]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\(?[ivxlcdmIVXLCDM]{1,6}[.)])$/;

function lineRect(line: PdfLine): Rect {
  return { x0: line.x, y0: line.yTop, x1: line.xEnd, y1: line.yBottom };
}

function unionRects(rects: Rect[]): Rect {
  return rects.reduce(
    (acc, r) => ({
      x0: Math.min(acc.x0, r.x0),
      y0: Math.min(acc.y0, r.y0),
      x1: Math.max(acc.x1, r.x1),
      y1: Math.max(acc.y1, r.y1),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function isBlank(line: PdfLine): boolean {
  return line.spans.every((s) => !s.text.trim());
}

/** Split a line wherever the horizontal gap is far wider than a space. */
export function splitSegments(line: PdfLine): TextSegment[] {
  const spans = line.spans.filter((s) => s.text.length > 0);
  const segments: TextSegment[] = [];
  let current: PdfSpan[] = [];

  const flush = () => {
    const meaningful = current.filter((s) => s.text.trim().length > 0);
    if (meaningful.length > 0) {
      segments.push({
        spans: current,
        x: meaningful[0].x,
        xEnd: meaningful[meaningful.length - 1].xEnd,
      });
    }
    current = [];
  };

  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!span.text.trim()) {
      // A wide whitespace-only run is itself a gap.
      const width = span.xEnd - span.x;
      if (width > span.spaceWidth * 3.2 && current.length > 0) {
        flush();
        continue;
      }
      if (current.length > 0) current.push(span);
      continue;
    }
    const prev = current.filter((s) => s.text.trim()).pop();
    if (prev) {
      const gap = span.x - prev.xEnd;
      if (gap > Math.max(6, Math.max(prev.spaceWidth, span.spaceWidth) * 3.2)) {
        flush();
      }
    }
    current.push(span);
  }
  flush();

  return segments.length > 0 ? segments : [{ spans, x: line.x, xEnd: line.xEnd }];
}

/** Merge adjacent runs that share styling so Word gets tidy, editable runs. */
export function mergeSpans(spans: PdfSpan[]): PdfSpan[] {
  const merged: PdfSpan[] = [];
  for (const span of spans) {
    const text = span.text.replace(/\r?\n/g, " ");
    if (!text) continue;
    const prev = merged[merged.length - 1];
    const sameStyle =
      prev &&
      prev.font.family === span.font.family &&
      prev.font.bold === span.font.bold &&
      prev.font.italic === span.font.italic &&
      prev.color === span.color &&
      prev.underline === span.underline &&
      prev.strike === span.strike &&
      prev.vertAlign === span.vertAlign &&
      prev.link === span.link &&
      Math.abs(prev.fontSize - span.fontSize) < 0.35;

    if (sameStyle) {
      const gap = span.x - prev.xEnd;
      // Tracked display headings arrive as one glyph per run. A 25pt title
      // with 4pt tracking is wider than 0.55 of a space, and inserting a
      // space there is what turns "Contributors" into "C o n t r i b u t o r s".
      const trackedLetters = prev.text.trim().length <= 1 && text.trim().length <= 1;
      const needsSpace =
        !trackedLetters &&
        gap > Math.max(prev.spaceWidth, span.spaceWidth) * 0.85 &&
        !/\s$/.test(prev.text) &&
        !/^\s/.test(text);
      prev.text += (needsSpace ? " " : "") + text;
      prev.xEnd = Math.max(prev.xEnd, span.xEnd);
      continue;
    }
    merged.push({ ...span, text });
  }

  // Runs of spaces are kept: they carry the indentation of code blocks and
  // other preformatted text, and Word stores them faithfully.
  return merged.filter(
    (s, i, all) => s.text.trim().length > 0 || (i > 0 && i < all.length - 1)
  );
}

/**
 * Split lines that straddle a column gutter.
 *
 * The text layer has no idea a page is set in columns: two columns printed
 * side by side share baselines, so their text arrives as one line spanning the
 * page. Left alone, the reading order comes out interleaved and every
 * segmentation step downstream sees full-width lines.
 *
 * A gutter only counts when the text on both sides fills its column the way
 * body copy does, or when a shaded band edge runs down it. Table columns leave
 * similar-looking gaps but their cells are short and unshaded, which is what
 * keeps tables out of this path.
 */
function splitAtGutters(lines: PdfLine[], pageWidth: number, bands: PdfFill[]): PdfLine[] {
  if (lines.length < 6) return lines;

  const segmented = lines.map((line) => ({ line, segments: splitSegments(line) }));
  const covered = new Uint8Array(Math.ceil(pageWidth) + 2);
  for (const { segments } of segmented) {
    for (const segment of segments) {
      const from = Math.max(0, Math.floor(segment.x));
      const to = Math.min(covered.length - 1, Math.ceil(segment.xEnd));
      for (let x = from; x <= to; x++) covered[x] = 1;
    }
  }

  const left = Math.min(...segmented.flatMap((s) => s.segments.map((seg) => seg.x)));
  const right = Math.max(...segmented.flatMap((s) => s.segments.map((seg) => seg.xEnd)));

  const gutters: Array<{ x0: number; x1: number }> = [];
  let runStart = -1;
  for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
    if (!covered[x]) {
      if (runStart < 0) runStart = x;
      continue;
    }
    if (runStart >= 0 && x - runStart >= MIN_GUTTER) gutters.push({ x0: runStart, x1: x });
    runStart = -1;
  }

  const accepted = gutters.filter((gutter) => {
    const centre = (gutter.x0 + gutter.x1) / 2;
    const leftLines = segmented.filter((s) => s.segments.some((seg) => seg.xEnd <= centre));
    const rightLines = segmented.filter((s) => s.segments.some((seg) => seg.x >= centre));
    if (leftLines.length < 3 || rightLines.length < 3) return false;

    // A sidebar's own shading is better evidence of a column than its text is:
    // its labels are ragged and short, so the body-copy test below rejects
    // them and the two columns come out interleaved.
    const onBandEdge = bands.some((band) =>
      [band.rect.x0, band.rect.x1].some((edge) => edge >= gutter.x0 - 2 && edge <= gutter.x1 + 2)
    );
    if (onBandEdge) return true;

    // Body copy reaches most of the way across its column; table cells do not.
    const fill = (rows: typeof segmented, from: number, to: number) => {
      const widths = rows.flatMap((s) =>
        s.segments.filter((seg) => seg.x >= from - 1 && seg.xEnd <= to + 1).map((seg) => seg.xEnd - seg.x)
      );
      if (widths.length === 0) return 0;
      const measure = Math.max(...widths);
      return widths.reduce((a, b) => a + b, 0) / widths.length / Math.max(1, measure);
    };
    if (fill(leftLines, left, centre) >= 0.75 && fill(rightLines, centre, right) >= 0.75) {
      return true;
    }
    // A contents column is a title plus a page number. The gap between those
    // two is a leader, not a column; only a gutter that leaves a title+page
    // pair on both sides is a real two-column contents page.
    const contentsSide = (rows: typeof segmented, from: number, to: number) => {
      const sides = rows
        .map((row) =>
          row.segments.filter((seg) => seg.x >= from - 1 && seg.xEnd <= to + 1)
        )
        .filter((segs) => segs.length > 0);
      if (sides.length < 6) return false;
      const numbered = sides.filter((segs) => {
        const last = segs[segs.length - 1].spans
          .map((span) => span.text)
          .join("")
          .split(TOC_TAB)
          .join("")
          .trim();
        return segs.length >= 2 && PAGE_REFERENCE.test(last);
      }).length;
      return numbered * 2 >= sides.length;
    };
    return contentsSide(leftLines, left, centre) && contentsSide(rightLines, centre, right);
  });

  if (accepted.length === 0) return lines;
  const cuts = accepted.map((g) => (g.x0 + g.x1) / 2);

  const out: PdfLine[] = [];
  for (const { line, segments } of segmented) {
    const buckets: PdfSpan[][] = Array.from({ length: cuts.length + 1 }, () => []);
    for (const segment of segments) {
      const centre = (segment.x + segment.xEnd) / 2;
      let index = 0;
      while (index < cuts.length && centre > cuts[index]) index += 1;
      buckets[index].push(...segment.spans);
    }
    const parts = buckets.filter((spans) => spans.some((s) => s.text.trim()));
    if (parts.length <= 1) {
      out.push(line);
      continue;
    }
    const split: PdfLine[] = [];
    for (const spans of parts) {
      split.push({
        ...line,
        spans,
        x: Math.min(...spans.map((s) => s.x)),
        xEnd: Math.max(...spans.map((s) => s.xEnd)),
      });
    }
    // A line that straddled the gutter was too wide to sit inside a band, so
    // its halves only pick up the sidebar's shading now they stand alone.
    applyFills(split, bands);
    out.push(...split);
  }
  return out.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
}


/**
 * Vertical edges of the page's shaded bands — the sidebar panel a designed CV
 * is built around. Only a tall, narrow band counts: a full-width heading strip
 * or a cell shading says nothing about where the columns are.
 */
function shadedBands(page: PageContent): PdfFill[] {
  return page.fills.filter((fill) => {
    const w = fill.rect.x1 - fill.rect.x0;
    const h = fill.rect.y1 - fill.rect.y0;
    if (h < page.height * 0.5 || w < 40 || w > page.width * 0.5) return false;
    return fill.rect.x0 > 2 || fill.rect.x1 < page.width - 2;
  });
}

type Node =
  | { type: "leaf"; lines: PdfLine[]; rect: Rect }
  | { type: "vertical"; children: Node[]; rect: Rect }
  | { type: "horizontal"; children: Node[]; rect: Rect };

/**
 * Recursive XY-cut. Horizontal cuts come first so a full-width heading above a
 * multi-column body does not block the column split underneath it.
 */
function segment(lines: PdfLine[], depth: number, bands: PdfFill[] = []): Node {
  const rect = unionRects(lines.map(lineRect));
  if (lines.length <= 1 || depth > 5) return { type: "leaf", lines, rect };

  const sorted = [...lines].sort((a, b) => a.yTop - b.yTop);
  const leading = median(
    sorted.slice(1).map((l, i) => l.baseline - sorted[i].baseline).filter((g) => g > 0)
  );

  // Horizontal cut: a vertical gap much larger than the body leading.
  const gapThreshold = Math.max(leading * 1.9, 9);
  let cutIndex = -1;
  let bestGap = 0;
  let bottom = sorted[0].yBottom;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].yTop - bottom;
    if (gap > gapThreshold && gap > bestGap) {
      bestGap = gap;
      cutIndex = i;
    }
    bottom = Math.max(bottom, sorted[i].yBottom);
  }
  if (cutIndex > 0) {
    const above = sorted.slice(0, cutIndex);
    const below = sorted.slice(cutIndex);
    return {
      type: "horizontal",
      children: [segment(above, depth + 1, bands), segment(below, depth + 1, bands)],
      rect,
    };
  }

  // Only now, with the band isolated by the horizontal cuts above, is it safe
  // to look for column gutters: a full-width heading or a centred line
  // elsewhere on the page would otherwise cover the gutter and hide it.
  const unstitched = splitAtGutters(sorted, rect.x1 - rect.x0 + rect.x0 * 2, bands);
  if (unstitched.length !== sorted.length) {
    const columns = findColumns(unstitched, rect);
    if (columns) {
      return {
        type: "vertical",
        children: columns.map((group) => segment(group, depth + 1, bands)),
        rect,
      };
    }
  }

  const columns = findColumns(sorted, rect);
  if (columns) {
    return {
      type: "vertical",
      children: columns.map((group) => segment(group, depth + 1, bands)),
      rect,
    };
  }

  return { type: "leaf", lines: sorted, rect };
}

/** Find full-height whitespace gutters that split a band into text columns. */
function findColumns(lines: PdfLine[], rect: Rect): PdfLine[][] | null {
  if (lines.length < 4) return null;
  const width = rect.x1 - rect.x0;
  if (width < 120) return null;

  const intervals = lines
    .map((l) => ({ x0: l.x, x1: l.xEnd }))
    .sort((a, b) => a.x0 - b.x0);

  const gutters: Array<{ x0: number; x1: number }> = [];
  let reach = intervals[0].x1;
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].x0 - reach >= MIN_GUTTER) {
      gutters.push({ x0: reach, x1: intervals[i].x0 });
    }
    reach = Math.max(reach, intervals[i].x1);
  }
  if (gutters.length === 0) return null;

  // Keep gutters that leave a usable column on both sides.
  const usable = gutters.filter(
    (g) => g.x0 - rect.x0 >= Math.max(40, width * 0.12) && rect.x1 - g.x1 >= Math.max(40, width * 0.12)
  );
  if (usable.length === 0) return null;

  const boundaries = [rect.x0 - 1, ...usable.map((g) => (g.x0 + g.x1) / 2), rect.x1 + 1];
  const groups: PdfLine[][] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const group = lines.filter(
      (l) => (l.x + l.xEnd) / 2 > boundaries[i] && (l.x + l.xEnd) / 2 <= boundaries[i + 1]
    );
    if (group.length === 0) return null;
    groups.push(group);
  }
  if (groups.length < 2) return null;

  // Columns only make sense when each side carries more than a stray line.
  if (groups.some((g) => g.length < 2)) return null;
  return groups;
}

function detectAlignment(
  lines: PdfLine[],
  blockLeft: number,
  blockRight: number
): ParagraphBox["align"] {
  const blockWidth = Math.max(1, blockRight - blockLeft);
  const edge = 3;
  const leftSlack = lines.map((l) => l.x - blockLeft);
  const rightSlack = lines.map((l) => blockRight - l.xEnd);
  const centreOffset = lines.map((l) => (l.x + l.xEnd) / 2 - (blockLeft + blockRight) / 2);

  const allLeft = leftSlack.every((s) => Math.abs(s) <= edge);
  const allRight = rightSlack.every((s) => Math.abs(s) <= edge);

  // Centred text is inset on both sides and stacked about the same axis.
  // Without the inset test, a flush-left line that happens to fall short of
  // the measure would read as centred.
  const insetBoth =
    leftSlack.every((s) => s > edge * 2) && rightSlack.every((s) => s > edge * 2);
  if (insetBoth && centreOffset.every((s) => Math.abs(s) <= Math.max(4, blockWidth * 0.02))) {
    return "center";
  }

  if (allRight && !allLeft) return "right";

  if (lines.length > 1) {
    // Justified copy has every line but the last flush on both sides.
    const body = lines.slice(0, -1);
    const flushBoth = body.every(
      (l) => Math.abs(l.x - blockLeft) <= edge && Math.abs(blockRight - l.xEnd) <= edge + 0.5
    );
    if (flushBoth) return "justify";
  }
  return "left";
}

function detectListMarker(line: PdfLine): string | undefined {
  const segments = splitSegments(line);
  const first = segments[0]?.spans.map((s) => s.text).join("").trim();
  if (!first) return undefined;
  // A marker separated from its text by a gap may drop the trailing dot.
  if (segments.length > 1 && (LIST_MARKER.test(first) || /^\(?[0-9A-Za-z]{1,3}[.)]?$/.test(first))) {
    return first;
  }

  const text = line.spans.map((s) => s.text).join("").trimStart();
  const match = /^([•▪◦‣∙·●○■□]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+/.exec(text);
  return match?.[1];
}

/** Group a leaf block's lines into paragraphs. */
function buildParagraphs(
  lines: PdfLine[],
  container: { left: number; right: number }
): ParagraphBox[] {
  const visible = lines.filter((l) => !isBlank(l)).sort((a, b) => a.yTop - b.yTop);
  if (visible.length === 0) return [];

  const blockLeft = Math.min(...visible.map((l) => l.x));
  const blockRight = Math.max(...visible.map((l) => l.xEnd));
  const gaps = visible.slice(1).map((l, i) => l.baseline - visible[i].baseline).filter((g) => g > 0);
  const blockLeading = median(gaps) || visible[0].fontSize * 1.2;

  const groups: PdfLine[][] = [];
  let current: PdfLine[] = [visible[0]];

  for (let i = 1; i < visible.length; i++) {
    const line = visible[i];
    const prev = visible[i - 1];
    const slop = Math.max(2, line.fontSize * 0.3);

    const gap = line.baseline - prev.baseline;
    // The block's median gap alone is not enough: a title page holds a handful
    // of widely spaced lines, so the median is itself large and every line
    // reads as a continuation of the one above. Lines of one paragraph are
    // never set more than about 1.6 times their own size apart, so that caps
    // it — a subtitle and an author's name stay separate paragraphs.
    const singleLine = Math.max(prev.fontSize, line.fontSize) * 1.6;
    const tight = gap > 0 && gap <= Math.min(blockLeading * 1.32, singleLine);
    const sameSize = Math.abs(line.fontSize - prev.fontSize) <= Math.max(0.6, prev.fontSize * 0.09);
    const sameShading = line.shading === prev.shading;

    // Three ways a line can be a continuation: it starts where the previous
    // line started, it is stacked on the same centre or right edge, or the
    // previous line ran to the edge of the measure and simply wrapped.
    const sameLeft = Math.abs(line.x - prev.x) <= slop;
    const sameRight = Math.abs(line.xEnd - prev.xEnd) <= slop;
    const sameCentre =
      Math.abs((line.x + line.xEnd) / 2 - (prev.x + prev.xEnd) / 2) <= Math.max(4, line.fontSize * 0.6);
    const prevWrapped = blockRight - prev.xEnd <= Math.max(4, prev.fontSize * 0.9);

    const continues = sameLeft || prevWrapped || sameRight || sameCentre;
    const indexRow = lineHasPageReference(prev) || lineHasPageReference(line);

    if (tight && sameSize && sameShading && !detectListMarker(line) && continues && !indexRow) {
      current.push(line);
    } else {
      groups.push(current);
      current = [line];
    }
  }
  groups.push(current);

  return groups.map((group) => {
    const groupRect = unionRects(group.map(lineRect));
    const groupGaps = group.slice(1).map((l, i) => l.baseline - group[i].baseline).filter((g) => g > 0);
    // A single-line paragraph has no leading of its own; using the block's
    // spacing would inflate the line box and push everything below it down.
    const leading =
      median(groupGaps) ||
      Math.max(group[0].yBottom - group[0].yTop, group[0].fontSize * 1.15);
    const marker = detectListMarker(group[0]);

    // Alignment needs a measure wider than the paragraph itself; indents are
    // then taken from the paragraph's own extent so an inset block keeps its
    // inset rather than being read as centred text.
    const measure =
      visible.length > 1 && blockRight - blockLeft > (container.right - container.left) * 0.4
        ? { left: blockLeft, right: blockRight }
        : container;
    const align = detectAlignment(group, measure.left, measure.right);

    const firstX = group[0].x;
    const groupLeft = Math.min(...group.map((l) => l.x));
    const groupRight = Math.max(...group.map((l) => l.xEnd));
    const restLeft = group.length > 1 ? Math.min(...group.slice(1).map((l) => l.x)) : firstX;

    let firstLineIndent = 0;
    let hangingIndent = 0;
    if (align === "left" || align === "justify") {
      if (marker && group.length > 1 && restLeft > firstX + 2) {
        hangingIndent = restLeft - firstX;
      } else if (group.length > 1 && firstX > restLeft + 2) {
        firstLineIndent = firstX - restLeft;
      }
    }

    return {
      kind: "paragraph" as const,
      lines: group,
      segments: group.map(splitSegments),
      rect: groupRect,
      blockLeft:
        align === "center" || align === "right"
          ? measure.left
          : hangingIndent > 0
            ? firstX
            : groupLeft,
      blockRight: align === "center" ? measure.right : groupRight,
      align,
      firstLineIndent,
      hangingIndent,
      leading,
      fontSize: median(group.map((l) => l.fontSize)) || group[0].fontSize,
      spaceBefore: 0,
      listMarker: marker,
      shading: group.every((l) => l.shading === group[0].shading) ? group[0].shading : undefined,
    };
  });
}

function flattenNode(node: Node): PdfLine[] {
  if (node.type === "leaf") return node.lines;
  return node.children.flatMap(flattenNode);
}

/**
 * Splits a run of lines into table regions and plain-text runs, in reading
 * order. `ruledOnly` suppresses whitespace-alignment detection, which is what
 * a column split needs: side-by-side body copy always aligns.
 */
export type TableSplitter = (
  lines: PdfLine[],
  ruledOnly: boolean
) => Array<TableBox | PdfLine[]>;

export type BuildContext = {
  page: PageContent;
  /** Ruling lines available for table detection. */
  rules: PdfRule[];
  splitTables: TableSplitter;
  /** The page's text column, used to judge alignment of short blocks. */
  container: { left: number; right: number };
};

function partsToBoxes(parts: Array<TableBox | PdfLine[]>, ctx: BuildContext): Box[] {
  const boxes: Box[] = [];
  for (const part of parts) {
    if (Array.isArray(part)) {
      boxes.push(...buildParagraphs(part, ctx.container));
    } else {
      boxes.push(part);
    }
  }
  return boxes;
}

function nodeToBoxes(node: Node, ctx: BuildContext): Box[] {
  if (node.type === "leaf") {
    return partsToBoxes(ctx.splitTables(node.lines, false), ctx);
  }

  if (node.type === "horizontal") {
    return node.children.flatMap((child) => nodeToBoxes(child, ctx));
  }

  // A ruled grid can straddle a column split, so it still gets first refusal.
  // Whitespace alignment is deliberately not consulted here: side-by-side body
  // copy always aligns, and turning it into a row-per-line table would stop it
  // reflowing.
  const lines = flattenNode(node);
  const parts = ctx.splitTables(lines, true);
  if (parts.length === 1 && !Array.isArray(parts[0])) return [parts[0]];

  const columns = node.children.map((child) =>
    nodeToBoxes(child, { ...ctx, container: { left: child.rect.x0, right: child.rect.x1 } })
  );
  const widths = node.children.map((child) => Math.max(1, child.rect.x1 - child.rect.x0));
  return [
    {
      kind: "columns",
      columns,
      widths,
      rect: node.rect,
      spaceBefore: 0,
    },
  ];
}

function boxRect(box: Box): Rect | null {
  switch (box.kind) {
    case "paragraph":
    case "table":
    case "columns":
      return box.rect;
    case "image":
      return box.image.rect;
    default:
      return null;
  }
}

/** Convert the vertical gaps between boxes into Word "space before" values. */
function applySpacing(boxes: Box[], startY: number, maxGap: number): void {
  let cursor = startY;
  for (const box of boxes) {
    const rect = boxRect(box);
    if (!rect) continue;
    const gap = rect.y0 - cursor;
    if (box.kind === "paragraph") {
      // A paragraph's first line already reserves its own leading, so only the
      // slack beyond one line height counts as space before.
      const slack = gap - Math.max(0, box.leading - box.fontSize * 1.16);
      box.spaceBefore = Math.max(0, Math.min(maxGap, slack));
    } else if (box.kind !== "spacer") {
      box.spaceBefore = Math.max(0, Math.min(maxGap, gap));
    }
    cursor = Math.max(cursor, rect.y1);
  }
}

/**
 * Split the page into running header, body and running footer bands.
 *
 * A band is only taken when a real whitespace gap separates it from the body:
 * a fixed "top 12% of the page" rule would swallow the first lines of body
 * copy on a tightly set page. The band must also be small and no larger than
 * the body text, so a title never disappears into the header.
 */
function splitBands(
  lines: PdfLine[],
  pageHeight: number
): { header: PdfLine[]; body: PdfLine[]; footer: PdfLine[] } {
  const sorted = [...lines].sort((a, b) => a.yTop - b.yTop);
  if (sorted.length < 4) return { header: [], body: sorted, footer: [] };

  const bodySize = median(sorted.map((l) => l.fontSize));
  const gaps = sorted.slice(1).map((l, i) => l.yTop - sorted[i].yBottom);
  const leading = median(gaps.filter((g) => g > -2));
  const detach = Math.max(10, Math.max(leading, bodySize * 0.3) * 2.2, bodySize * 1.4);

  const acceptable = (band: PdfLine[]) =>
    band.length > 0 &&
    band.length <= 3 &&
    band.every((l) => l.fontSize <= bodySize * 1.12);

  let headerEnd = 0;
  for (let i = 1; i <= Math.min(3, sorted.length - 1); i++) {
    if (sorted[i].yTop - sorted[i - 1].yBottom < detach) continue;
    const band = sorted.slice(0, i);
    if (band[band.length - 1].yBottom <= pageHeight * 0.18 && acceptable(band)) headerEnd = i;
    break;
  }

  let footerStart = sorted.length;
  for (let i = sorted.length - 1; i >= Math.max(headerEnd + 1, sorted.length - 3); i--) {
    if (sorted[i].yTop - sorted[i - 1].yBottom < detach) continue;
    const band = sorted.slice(i);
    if (band[0].yTop >= pageHeight * 0.82 && acceptable(band)) footerStart = i;
    break;
  }

  return {
    header: sorted.slice(0, headerEnd),
    body: sorted.slice(headerEnd, footerStart),
    footer: sorted.slice(footerStart),
  };
}

function computeMargins(
  bodyRect: Rect | null,
  page: PageContent,
  header: PdfLine[],
  footer: PdfLine[]
) {
  const fallback = { top: 72, right: 72, bottom: 72, left: 72 };
  if (!bodyRect || !Number.isFinite(bodyRect.x0)) return fallback;

  const clampH = (v: number) => Math.max(0, Math.min(MAX_MARGIN, Math.round(v)));
  return {
    left: clampH(bodyRect.x0),
    right: clampH(page.width - bodyRect.x1),
    top: clampH(bodyRect.y0),
    bottom: clampH(page.height - bodyRect.y1),
    headerLines: header,
    footerLines: footer,
  };
}

export function buildPageLayout(
  page: PageContent,
  splitTables: TableSplitter,
  options: { scanned: boolean }
): PageLayout {
  if (options.scanned) {
    return {
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      contentTop: 0,
      headerDistance: 0,
      footerDistance: 0,
      header: [],
      footer: [],
      body: [],
      scanned: true,
    };
  }

  // Artwork replaces the text drawn inside it — those glyphs are part of the
  // picture, and keeping both would duplicate the content.
  const artworkRects = page.artwork.map((a) => a.rect);
  const lines = page.lines.filter(
    (line) =>
      !isBlank(line) &&
      !artworkRects.some(
        (r) =>
          line.x >= r.x0 - 1 && line.xEnd <= r.x1 + 1 && line.yTop >= r.y0 - 1 && line.yBottom <= r.y1 + 1
      )
  );

  const bands = splitBands(lines, page.height);
  const bodyLines = bands.body;

  const bodyRect = bodyLines.length > 0 ? unionRects(bodyLines.map(lineRect)) : null;
  const pictures = [...page.images, ...page.artwork];
  const pictureRect = pictures.length > 0 ? unionRects(pictures.map((p) => p.rect)) : null;
  const contentRect =
    bodyRect && pictureRect
      ? {
          x0: Math.min(bodyRect.x0, pictureRect.x0),
          y0: Math.min(bodyRect.y0, pictureRect.y0),
          x1: Math.max(bodyRect.x1, pictureRect.x1),
          y1: Math.max(bodyRect.y1, pictureRect.y1),
        }
      : (bodyRect ?? pictureRect);

  const margins = computeMargins(contentRect, page, bands.header, bands.footer);
  const ctx: BuildContext = {
    page,
    rules: page.rules,
    splitTables,
    container: {
      left: contentRect && Number.isFinite(contentRect.x0) ? contentRect.x0 : 0,
      right: contentRect && Number.isFinite(contentRect.x1) ? contentRect.x1 : page.width,
    },
  };

  const body =
    bodyLines.length > 0 ? nodeToBoxes(segment(bodyLines, 0, shadedBands(page)), ctx) : [];

  // Reserve vertical space for every picture so the floating anchor lands on
  // the right page and the text below it keeps its original position.
  const boxes: Box[] = [...body];
  for (const picture of pictures) {
    boxes.push({ kind: "image", image: picture, spaceBefore: 0 });
  }
  boxes.sort((a, b) => (boxRect(a)?.y0 ?? 0) - (boxRect(b)?.y0 ?? 0));

  applySpacing(boxes, contentRect?.y0 ?? 0, page.height);

  const headerBoxes = bands.header.length > 0 ? nodeToBoxes(segment(bands.header, 3), ctx) : [];
  const footerBoxes = bands.footer.length > 0 ? nodeToBoxes(segment(bands.footer, 3), ctx) : [];
  if (headerBoxes.length > 0) {
    applySpacing(headerBoxes, unionRects(bands.header.map(lineRect)).y0, page.height);
  }
  if (footerBoxes.length > 0) {
    applySpacing(footerBoxes, unionRects(bands.footer.map(lineRect)).y0, page.height);
  }

  return {
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    margins: {
      top: margins.top,
      right: margins.right,
      bottom: margins.bottom,
      left: margins.left,
    },
    contentTop: contentRect?.y0 ?? margins.top,
    headerDistance:
      bands.header.length > 0 ? Math.max(0, unionRects(bands.header.map(lineRect)).y0) : 36,
    footerDistance:
      bands.footer.length > 0
        ? Math.max(0, page.height - unionRects(bands.footer.map(lineRect)).y1)
        : 36,
    header: headerBoxes,
    footer: footerBoxes,
    body: boxes,
    scanned: false,
  };
}

/** Rough height a box will occupy once Word lays it out, in points. */
function boxHeight(box: Box): number {
  switch (box.kind) {
    case "paragraph":
      return box.lines.length * Math.max(box.leading, box.fontSize * 1.02);
    case "table":
      return box.rect.y1 - box.rect.y0;
    case "columns":
      return box.rect.y1 - box.rect.y0;
    case "image":
      return box.image.rect.y1 - box.image.rect.y0;
    case "spacer":
      return box.height;
    default:
      return 0;
  }
}

/**
 * Keep a page's content on its own page.
 *
 * Small differences between the PDF's font metrics and Word's accumulate down
 * a page, and once the total overshoots the text area the last block spills
 * onto a page of its own — the single most visible way a conversion stops
 * looking like the original. The gaps between blocks absorb the difference:
 * they are shrunk proportionally, and never below zero.
 */
export function fitToPage(layout: PageLayout): void {
  if (layout.scanned) return;
  const available = layout.height - layout.margins.top - layout.margins.bottom;
  if (available <= 0) return;

  const boxes = layout.body;
  const content = boxes.reduce((sum, box) => sum + boxHeight(box), 0);
  const gaps = boxes.reduce(
    (sum, box) => sum + (box.kind === "spacer" ? 0 : box.spaceBefore),
    0
  );
  const total = content + gaps;
  if (total <= available || gaps <= 0) return;

  const keep = Math.max(0, (available - content) / gaps);
  for (const box of boxes) {
    if (box.kind === "spacer") continue;
    box.spaceBefore *= keep;
  }

}

export function isScannedPage(page: PageContent): boolean {
  if (page.textChars >= 24) return false;
  // A genuinely blank page stays blank; rendering it would embed a white
  // picture and bloat the document for nothing.
  if (
    page.images.length === 0 &&
    page.artwork.length === 0 &&
    page.rules.length === 0 &&
    page.fills.length === 0
  ) {
    return false;
  }
  const pageArea = page.width * page.height;
  return [...page.images, ...page.artwork].some(
    (i) => (i.rect.x1 - i.rect.x0) * (i.rect.y1 - i.rect.y0) >= pageArea * 0.55
  );
}

export type { PdfLine, PdfSpan, Rect };
