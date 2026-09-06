import { LIST_MARKER, splitSegments, type Box, type TableBox, type TableCellBox } from "./layout";
import type { PageContent, PdfFill, PdfLine, PdfRule, Rect } from "./types";

/**
 * Table recovery.
 *
 * Two independent detectors run, strongest evidence first:
 *   1. Ruled grids — clusters of horizontal and vertical rules that form a
 *      lattice. Cell spans are read straight from the missing rule segments.
 *   2. Borderless grids — runs of lines whose whitespace gaps land on the same
 *      column boundaries. This only runs inside a single text column, so
 *      newspaper-style body copy can never be mistaken for a table.
 */

const SNAP = 2.5;
const MIN_CELL = 6;

function clusterValues(values: number[], tolerance: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let group = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - group[group.length - 1] <= tolerance) {
      group.push(sorted[i]);
    } else {
      out.push(group.reduce((a, b) => a + b, 0) / group.length);
      group = [sorted[i]];
    }
  }
  out.push(group.reduce((a, b) => a + b, 0) / group.length);
  return out;
}

function spans(rules: PdfRule[], pos: number, from: number, to: number): boolean {
  // True when the rules collectively cover [from, to] at coordinate `pos`.
  const relevant = rules
    .filter((r) => Math.abs(r.pos - pos) <= SNAP && r.end > from + 0.5 && r.start < to - 0.5)
    .sort((a, b) => a.start - b.start);
  if (relevant.length === 0) return false;
  let reach = from;
  for (const rule of relevant) {
    if (rule.start > reach + 1.5) break;
    reach = Math.max(reach, rule.end);
    if (reach >= to - 1.5) return true;
  }
  return reach >= to - 1.5;
}

type Grid = { xs: number[]; ys: number[]; rect: Rect };

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/**
 * Recover ruled grids.
 *
 * The vertical rules are the anchor: a table's column separators all run the
 * height of the table, which pins down its extent far more reliably than the
 * horizontal rules do. Horizontal rules elsewhere on the page — a rule under a
 * running head, a single line under a heading — are then naturally excluded
 * instead of stretching the table over half the page.
 */
function findGrids(rules: PdfRule[]): Grid[] {
  let vertical = rules.filter((r) => !r.horizontal && r.end - r.start >= MIN_CELL);
  let horizontal = rules.filter((r) => r.horizontal && r.end - r.start >= MIN_CELL);
  if (vertical.length > 60) {
    vertical = [...vertical].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 60);
  }
  if (horizontal.length > 80) {
    horizontal = [...horizontal].sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 80);
  }
  if (vertical.length < 2 || horizontal.length < 2) return [];

  type Cluster = { rules: PdfRule[]; y0: number; y1: number };
  const clusters: Cluster[] = [];
  for (const rule of [...vertical].sort((a, b) => a.start - b.start || a.pos - b.pos)) {
    const span = rule.end - rule.start;
    const hit = clusters.find(
      (c) => overlap(c.y0, c.y1, rule.start, rule.end) >= Math.min(span, c.y1 - c.y0) * 0.6
    );
    if (hit) {
      hit.rules.push(rule);
      hit.y0 = Math.min(hit.y0, rule.start);
      hit.y1 = Math.max(hit.y1, rule.end);
    } else {
      clusters.push({ rules: [rule], y0: rule.start, y1: rule.end });
    }
  }

  const grids: Grid[] = [];
  for (const cluster of clusters) {
    const xs = clusterValues(cluster.rules.map((r) => r.pos), SNAP);
    if (xs.length < 2) continue;
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    if (x1 - x0 < 24 || cluster.y1 - cluster.y0 < MIN_CELL) continue;

    const inside = horizontal.filter(
      (r) =>
        r.pos >= cluster.y0 - SNAP &&
        r.pos <= cluster.y1 + SNAP &&
        overlap(x0, x1, r.start, r.end) >= (x1 - x0) * 0.5
    );
    let ys = clusterValues(inside.map((r) => r.pos), SNAP);
    if (ys.length === 0) continue;
    if (ys[0] > cluster.y0 + SNAP) ys = [cluster.y0, ...ys];
    if (ys[ys.length - 1] < cluster.y1 - SNAP) ys = [...ys, cluster.y1];
    if (ys.length < 2) continue;

    grids.push({ xs, ys, rect: { x0, y0: ys[0], x1, y1: ys[ys.length - 1] } });
  }
  return grids;
}

function lineCenter(line: PdfLine): { x: number; y: number } {
  return { x: (line.x + line.xEnd) / 2, y: (line.yTop + line.yBottom) / 2 };
}

/**
 * Keep only the part of a line that falls inside a rectangle.
 *
 * A row of a ruled table is a single line as far as the text layer is
 * concerned, so cells have to be filled span by span rather than line by line.
 */
function sliceLine(line: PdfLine, rect: Rect): PdfLine | null {
  const centreY = (line.yTop + line.yBottom) / 2;
  if (centreY < rect.y0 - 1 || centreY > rect.y1 + 1) return null;
  const spans = line.spans.filter((span) => {
    if (!span.text.trim()) return false;
    const centre = (span.x + span.xEnd) / 2;
    return centre >= rect.x0 - 1 && centre <= rect.x1 + 1;
  });
  if (spans.length === 0) return null;
  return {
    ...line,
    spans,
    x: Math.min(...spans.map((s) => s.x)),
    xEnd: Math.max(...spans.map((s) => s.xEnd)),
  };
}

function fillAt(fills: PdfFill[], rect: Rect): string | undefined {
  let best: PdfFill | undefined;
  let bestArea = Infinity;
  for (const fill of fills) {
    const r = fill.rect;
    if (r.x0 > rect.x0 + 2 || r.x1 < rect.x1 - 2 || r.y0 > rect.y0 + 2 || r.y1 < rect.y1 - 2) continue;
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    if (area < bestArea) {
      bestArea = area;
      best = fill;
    }
  }
  return best && best.color !== "FFFFFF" ? best.color : undefined;
}

type CellPlan = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  rect: Rect;
};

/** Merge grid slots that have no separating rule into spanning cells. */
function planCells(grid: Grid, rules: PdfRule[]): CellPlan[] {
  const rows = grid.ys.length - 1;
  const cols = grid.xs.length - 1;
  const horizontal = rules.filter((r) => r.horizontal);
  const vertical = rules.filter((r) => !r.horizontal);
  const taken: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const plans: CellPlan[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (taken[r][c]) continue;

      let colSpan = 1;
      while (
        c + colSpan < cols &&
        !taken[r][c + colSpan] &&
        !spans(vertical, grid.xs[c + colSpan], grid.ys[r], grid.ys[r + 1])
      ) {
        colSpan += 1;
      }

      let rowSpan = 1;
      while (r + rowSpan < rows) {
        let clear = true;
        for (let k = 0; k < colSpan; k++) {
          if (
            taken[r + rowSpan][c + k] ||
            spans(horizontal, grid.ys[r + rowSpan], grid.xs[c + k], grid.xs[c + k + 1])
          ) {
            clear = false;
            break;
          }
        }
        if (!clear) break;
        rowSpan += 1;
      }

      for (let i = 0; i < rowSpan; i++) {
        for (let k = 0; k < colSpan; k++) taken[r + i][c + k] = true;
      }
      plans.push({
        row: r,
        col: c,
        rowSpan,
        colSpan,
        rect: {
          x0: grid.xs[c],
          y0: grid.ys[r],
          x1: grid.xs[c + colSpan],
          y1: grid.ys[r + rowSpan],
        },
      });
    }
  }
  return plans;
}

export type { TableSplitter } from "./layout";

export function createTableSplitter(
  page: PageContent,
  buildCellContent: (lines: PdfLine[], rect: Rect) => Box[]
) {
  const grids = findGrids(page.rules);
  const horizontalRules = page.rules.filter((r) => r.horizontal);
  const verticalRules = page.rules.filter((r) => !r.horizontal);

  return (lines: PdfLine[], ruledOnly = false): Array<TableBox | PdfLine[]> => {
    const sorted = [...lines]
      .filter((l) => l.spans.some((s) => s.text.trim()))
      .sort((a, b) => a.yTop - b.yTop);
    if (sorted.length === 0) return [];

    type Region = { start: number; end: number; table: TableBox };
    const regions: Region[] = [];
    const claimed = new Array(sorted.length).fill(false);

    for (const grid of grids) {
      const indexes = sorted
        .map((line, i) => ({ line, i }))
        .filter(({ line, i }) => !claimed[i] && insideGrid(line, grid))
        .map(({ i }) => i);
      if (indexes.length < 2) continue;

      const start = indexes[0];
      const end = indexes[indexes.length - 1] + 1;
      // Anything not in the grid may not be interleaved with it.
      if (indexes.length !== end - start) continue;

      const table = buildRuledTable(grid, sorted.slice(start, end));
      if (!table) continue;
      for (let i = start; i < end; i++) claimed[i] = true;
      regions.push({ start, end, table });
    }

    if (!ruledOnly) {
      for (const region of findAlignedRuns(sorted, claimed)) {
        regions.push(region);
        for (let i = region.start; i < region.end; i++) claimed[i] = true;
      }
    }

    regions.sort((a, b) => a.start - b.start);

    const parts: Array<TableBox | PdfLine[]> = [];
    let cursor = 0;
    for (const region of regions) {
      if (region.start > cursor) parts.push(sorted.slice(cursor, region.start));
      parts.push(region.table);
      cursor = region.end;
    }
    if (cursor < sorted.length) parts.push(sorted.slice(cursor));
    return parts;
  };

  function insideGrid(line: PdfLine, grid: Grid): boolean {
    const c = lineCenter(line);
    return (
      c.x >= grid.rect.x0 - 2 &&
      c.x <= grid.rect.x1 + 2 &&
      c.y >= grid.rect.y0 - 2 &&
      c.y <= grid.rect.y1 + 2
    );
  }

  function buildRuledTable(grid: Grid, lines: PdfLine[]): TableBox | null {
    const rowCount = grid.ys.length - 1;
    const colCount = grid.xs.length - 1;
    if (rowCount < 1 || colCount < 2) return null;

    const rows: TableCellBox[][] = Array.from({ length: rowCount }, () => []);
    for (const plan of planCells(grid, page.rules).sort((a, b) => a.row - b.row || a.col - b.col)) {
      const cellLines = lines
        .map((line) => sliceLine(line, plan.rect))
        .filter((line): line is PdfLine => line !== null);
      rows[plan.row].push({
        content: buildCellContent(cellLines, plan.rect),
        rect: plan.rect,
        columnSpan: plan.colSpan,
        rowSpan: plan.rowSpan,
        verticalAlign: verticalAlignOf(cellLines, plan.rect),
        shading: fillAt(page.fills, plan.rect),
        borders: {
          top: spans(horizontalRules, plan.rect.y0, plan.rect.x0, plan.rect.x1),
          bottom: spans(horizontalRules, plan.rect.y1, plan.rect.x0, plan.rect.x1),
          left: spans(verticalRules, plan.rect.x0, plan.rect.y0, plan.rect.y1),
          right: spans(verticalRules, plan.rect.x1, plan.rect.y0, plan.rect.y1),
        },
      });
    }

    const nonEmpty = rows.filter((r) => r.length > 0);
    if (nonEmpty.length === 0) return null;

    const table: TableBox = {
      kind: "table",
      rows: nonEmpty,
      columnWidths: grid.xs.slice(1).map((x, i) => Math.max(MIN_CELL, x - grid.xs[i])),
      rowHeights: grid.ys.slice(1).map((y, i) => Math.max(MIN_CELL, y - grid.ys[i])),
      rect: grid.rect,
      spaceBefore: 0,
      bordered: true,
    };
    applyColumnAlignment(table);
    return table;
  }

  /**
   * Borderless tables: runs of adjacent lines whose gap-separated segments land
   * in the same columns. A column counts as aligned when either its left or its
   * right edges line up, so right-aligned figures are recognised too. Three
   * rows are required, which keeps a chance pair of lines out.
   */
  function findAlignedRuns(
    lines: PdfLine[],
    claimed: boolean[]
  ): Array<{ start: number; end: number; table: TableBox }> {
    const segmented = lines.map((line) => splitSegments(line));
    const out: Array<{ start: number; end: number; table: TableBox }> = [];

    let i = 0;
    while (i < lines.length) {
      if (claimed[i] || segmented[i].length < 2) {
        i += 1;
        continue;
      }
      const columnCount = segmented[i].length;
      const tolerance = Math.max(5, lines[i].fontSize * 0.9);
      const spacing = Math.max(lines[i].fontSize * 2.6, 14);
      const starts = segmented[i].map((s) => s.x);
      const ends = segmented[i].map((s) => s.xEnd);

      let j = i + 1;
      while (
        j < lines.length &&
        !claimed[j] &&
        segmented[j].length === columnCount &&
        lines[j].yTop - lines[j - 1].yBottom < spacing &&
        segmented[j].every(
          (seg, k) =>
            Math.abs(seg.x - starts[k]) <= tolerance || Math.abs(seg.xEnd - ends[k]) <= tolerance
        )
      ) {
        j += 1;
      }

      // A bulleted or numbered list aligns just like a two-column table; the
      // marker in the first cell is what gives it away.
      const markerColumn =
        columnCount === 2 && segmented[i][0].xEnd - segmented[i][0].x <= lines[i].fontSize * 3;
      const isList =
        markerColumn &&
        segmented
          .slice(i, j)
          .every((row) => {
            const text = row[0].spans.map((s) => s.text).join("").trim();
            return LIST_MARKER.test(text) || /^\(?[0-9A-Za-z]{1,3}[.)]?$/.test(text);
          });

      // A table of contents aligns exactly like a two- or four-column table:
      // a title, then a page number. What gives it away is that the numbers
      // climb as the list goes down, which a column of data almost never does
      // beside long prose. Reading it as a table costs the tab leaders and
      // makes the entries uneditable.
      const rowsHere = segmented.slice(i, j);
      const cellText = (row: (typeof segmented)[number], k: number) =>
        row[k].spans.map((s) => s.text).join("").trim();
      const isContents = (() => {
        let numeric = 0;
        for (let k = 0; k < columnCount; k++) {
          const values = rowsHere.map((row) => cellText(row, k));
          if (!values.every((v) => /^\d{1,4}$/.test(v))) continue;
          const numbers = values.map(Number);
          const climbs = numbers.every((n, at) => at === 0 || n >= numbers[at - 1]);
          // The column beside the numbers has to read as titles: never a bare
          // number itself, and mostly long enough to be a heading. Short
          // entries — "Scans", "Joins" — are normal in a contents list, so
          // this asks for a majority rather than every row.
          const titles = k > 0 ? rowsHere.map((row) => cellText(row, k - 1)) : [];
          const prose =
            titles.length > 0 &&
            titles.every((t) => t.length > 0 && !/^\d{1,4}$/.test(t)) &&
            titles.filter((t) => t.length >= 8).length * 2 >= titles.length;
          if (climbs && prose) numeric += 1;
        }
        return numeric > 0;
      })();

      if (j - i >= 3 && !isList && !isContents) {
        const table = buildAlignedTable(lines.slice(i, j), segmented.slice(i, j));
        if (table) {
          out.push({ start: i, end: j, table });
          i = j;
          continue;
        }
      }
      i += 1;
    }
    return out;
  }

  function buildAlignedTable(
    rows: PdfLine[],
    segmented: ReturnType<typeof splitSegments>[]
  ): TableBox | null {
    const columnCount = segmented[0].length;
    const extents = Array.from({ length: columnCount }, (_, k) => ({
      x0: Math.min(...segmented.map((row) => row[k].x)),
      x1: Math.max(...segmented.map((row) => row[k].xEnd)),
    }));
    // Columns that overlap are not columns.
    for (let k = 1; k < columnCount; k++) {
      if (extents[k].x0 <= extents[k - 1].x1) return null;
    }

    const bounds: number[] = [extents[0].x0];
    for (let k = 1; k < columnCount; k++) {
      bounds.push((extents[k - 1].x1 + extents[k].x0) / 2);
    }
    bounds.push(extents[columnCount - 1].x1);

    // Row bands reach halfway to the neighbouring row so a separating rule
    // drawn between two rows is recognised as a cell border.
    const bands = rows.map((line, r) => ({
      y0: r === 0 ? line.yTop : (rows[r - 1].yBottom + line.yTop) / 2,
      y1: r === rows.length - 1 ? line.yBottom : (line.yBottom + rows[r + 1].yTop) / 2,
    }));

    const widths = bounds.slice(1).map((x, k) => Math.max(MIN_CELL, x - bounds[k]));
    const cellRows: TableCellBox[][] = segmented.map((row, r) =>
      row.map((seg, k) => {
        const rect = { x0: bounds[k], y0: bands[r].y0, x1: bounds[k + 1], y1: bands[r].y1 };
        const line: PdfLine = { ...rows[r], spans: seg.spans, x: seg.x, xEnd: seg.xEnd };
        return {
          content: buildCellContent([line], rect),
          rect,
          columnSpan: 1,
          rowSpan: 1,
          verticalAlign: verticalAlignOf([line], rect),
          shading: fillAt(page.fills, rect),
          borders: {
            top: spans(horizontalRules, rect.y0, rect.x0, rect.x1),
            bottom: spans(horizontalRules, rect.y1, rect.x0, rect.x1),
            left: false,
            right: false,
          },
        };
      })
    );

    const bordered = cellRows.some((row) => row.some((c) => c.borders.top || c.borders.bottom));
    const table: TableBox = {
      kind: "table",
      rows: cellRows,
      columnWidths: widths,
      rowHeights: bands.map((band) => Math.max(MIN_CELL, band.y1 - band.y0)),
      rect: {
        x0: bounds[0],
        y0: bands[0].y0,
        x1: bounds[bounds.length - 1],
        y1: bands[bands.length - 1].y1,
      },
      spaceBefore: 0,
      bordered,
    };
    applyColumnAlignment(table);
    return table;
  }
}

/**
 * Reproduce each column's alignment. Numeric columns are usually set flush
 * right in the source; without this every cell would come out flush left.
 */
function applyColumnAlignment(table: TableBox): void {
  const columns = new Map<number, TableCellBox[]>();
  for (const row of table.rows) {
    let index = 0;
    for (const cell of row) {
      const list = columns.get(index);
      if (list) list.push(cell);
      else columns.set(index, [cell]);
      index += cell.columnSpan;
    }
  }

  for (const cells of columns.values()) {
    const samples = cells
      .map((cell) => {
        const paragraphs = cell.content.filter(
          (box): box is Extract<Box, { kind: "paragraph" }> => box.kind === "paragraph"
        );
        if (paragraphs.length !== 1) return null;
        const [box] = paragraphs;
        return {
          box,
          left: box.rect.x0 - cell.rect.x0,
          right: cell.rect.x1 - box.rect.x1,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    if (samples.length < 2) continue;

    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    const lefts = samples.map((s) => s.left);
    const rights = samples.map((s) => s.right);
    const leftSpread = spread(lefts);
    const rightSpread = spread(rights);
    const centreSpread = spread(samples.map((s) => s.left - s.right));

    let align: "left" | "center" | "right" | null = null;
    if (rightSpread + 2 < leftSpread && rightSpread <= 4) align = "right";
    else if (centreSpread <= 4 && leftSpread > 6 && rightSpread > 6) align = "center";

    if (!align) continue;
    for (const sample of samples) {
      sample.box.align = align;
      sample.box.blockLeft = sample.box.rect.x0 - sample.left;
      sample.box.blockRight = sample.box.rect.x1 + sample.right;
    }
  }
}

/** Where a cell's text sits between the top and bottom of its box. */
function verticalAlignOf(lines: PdfLine[], rect: Rect): "top" | "center" | "bottom" {
  if (lines.length === 0) return "center";
  const top = Math.min(...lines.map((l) => l.yTop));
  const bottom = Math.max(...lines.map((l) => l.yBottom));
  const above = top - rect.y0;
  const below = rect.y1 - bottom;
  const slack = rect.y1 - rect.y0 - (bottom - top);
  if (slack <= 4) return "center";
  if (above <= slack * 0.3) return "top";
  if (below <= slack * 0.3) return "bottom";
  return "center";
}
