import type {
  Align,
  Block,
  Borders,
  ParagraphBlock,
  RunStyle,
  Section,
  TableBlock,
  TableCellBlock,
  TableRowBlock,
  WordDocument,
} from "../office/types";
import { ExcelError, readWorkbook, type MergeRange, type Sheet, type SheetCell } from "./workbook";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 36;
/** A sheet wider than the page is shrunk to fit, but never past legibility. */
const MIN_SCALE = 0.4;
/** Spreadsheets can be arbitrarily tall; a browser tab cannot. */
const MAX_ROWS = 10000;

const GRIDLINE = { color: "#D0D0D0", width: 0.4 };

function paragraph(text: string, style: RunStyle, align: Align): ParagraphBlock {
  return {
    kind: "paragraph",
    align,
    indentLeft: 2,
    indentRight: 2,
    indentFirst: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    line: 240,
    lineExact: false,
    runs: text ? [{ kind: "text", text, style }] : [],
  };
}

/** Where a merge covers a cell, and which cell anchors it. */
function mergeIndex(merges: MergeRange[]): Map<string, MergeRange> {
  const map = new Map<string, MergeRange>();
  for (const merge of merges) {
    for (let r = merge.row; r < merge.row + merge.rows; r++) {
      for (let c = merge.col; c < merge.col + merge.cols; c++) {
        map.set(`${r}:${c}`, merge);
      }
    }
  }
  return map;
}

function buildRows(sheet: Sheet, scale: number, rowLimit: number): TableRowBlock[] {
  const byPosition = new Map<string, SheetCell>();
  for (const cell of sheet.cells) byPosition.set(`${cell.row}:${cell.col}`, cell);
  const covering = mergeIndex(sheet.merges);

  const rows: TableRowBlock[] = [];

  for (let r = 0; r < rowLimit; r++) {
    if (sheet.rowHeights[r] === 0) continue;

    const cells: TableCellBlock[] = [];
    let c = 0;

    while (c < sheet.columnCount) {
      const merge = covering.get(`${r}:${c}`);
      const span = merge ? merge.cols : 1;
      const continued = merge ? merge.row < r : false;
      const cell = byPosition.get(`${r}:${c}`);

      let width = 0;
      for (let i = c; i < c + span; i++) width += (sheet.columnWidths[i] ?? 48) * scale;

      const style = cell?.style;
      const font: RunStyle = {
        family: style?.font.family ?? "Calibri",
        fontSize: (style?.font.size ?? 11) * scale,
        bold: style?.font.bold ?? false,
        italic: style?.font.italic ?? false,
        underline: style?.font.underline ?? false,
        strike: style?.font.strike ?? false,
        color: style?.font.color ?? "#000000",
      };

      const align: Align =
        style?.horizontal ?? (cell?.numeric ? "right" : "left");

      const own = style?.borders ?? {};
      const borders: Borders = sheet.bare
        ? {
            top: own.top ?? GRIDLINE,
            right: own.right ?? GRIDLINE,
            bottom: own.bottom ?? GRIDLINE,
            left: own.left ?? GRIDLINE,
          }
        : own;

      cells.push({
        span,
        vMerge: merge && merge.rows > 1 ? (continued ? "continue" : "restart") : undefined,
        shading: style?.fill,
        borders,
        valign: style?.vertical ?? "bottom",
        width,
        // A continued merge draws nothing of its own; the anchor holds the text.
        blocks: continued ? [paragraph("", font, align)] : [paragraph(cell?.text ?? "", font, align)],
      });

      c += span;
    }

    const height = sheet.rowHeights[r];
    rows.push({
      cells,
      height: height !== undefined && height > 0 ? height * scale : undefined,
      header: false,
    });
  }

  return rows;
}

function sectionFor(sheet: Sheet, showName: boolean): Section | null {
  if (sheet.columnCount === 0 || sheet.rowCount === 0) return null;

  const naturalWidth = sheet.columnWidths
    .slice(0, sheet.columnCount)
    .reduce((total, width) => total + (width ?? 48), 0);

  // Landscape when the sheet is wider than it is tall on the page; a wide
  // spreadsheet reads far better across the long edge.
  const portraitContent = A4_WIDTH - MARGIN * 2;
  const landscapeContent = A4_HEIGHT - MARGIN * 2;
  const landscape = naturalWidth > portraitContent;
  const content = landscape ? landscapeContent : portraitContent;

  const scale = Math.max(MIN_SCALE, Math.min(1, content / Math.max(1, naturalWidth)));
  const rowLimit = Math.min(sheet.rowCount, MAX_ROWS);
  const rows = buildRows(sheet, scale, rowLimit);
  if (rows.length === 0) return null;

  const width = rows[0].cells.reduce((total, cell) => total + cell.width, 0);

  const table: TableBlock = {
    kind: "table",
    rows,
    width,
    indent: 0,
    borders: {},
  };

  const body: Block[] = [];
  if (showName) {
    body.push({
      kind: "paragraph",
      align: "left",
      indentLeft: 0,
      indentRight: 0,
      indentFirst: 0,
      spaceBefore: 0,
      spaceAfter: 8,
      line: 240,
      lineExact: false,
      runs: [
        {
          kind: "text",
          text: sheet.name,
          style: {
            family: "Calibri",
            fontSize: 13,
            bold: true,
            italic: false,
            underline: false,
            strike: false,
            color: "#1F3864",
          },
        },
      ],
    });
  }
  body.push(table);

  if (sheet.rowCount > rowLimit) {
    body.push({
      kind: "paragraph",
      align: "left",
      indentLeft: 0,
      indentRight: 0,
      indentFirst: 0,
      spaceBefore: 8,
      spaceAfter: 0,
      line: 240,
      lineExact: false,
      runs: [
        {
          kind: "text",
          text: `Showing the first ${rowLimit.toLocaleString()} of ${sheet.rowCount.toLocaleString()} rows.`,
          style: {
            family: "Calibri",
            fontSize: 9,
            bold: false,
            italic: true,
            underline: false,
            strike: false,
            color: "#666666",
          },
        },
      ],
    });
  }

  return {
    width: landscape ? A4_HEIGHT : A4_WIDTH,
    height: landscape ? A4_WIDTH : A4_HEIGHT,
    margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
    headerDistance: 24,
    footerDistance: 24,
    header: [],
    footer: [],
    body,
  };
}

/**
 * Read a workbook as a document the shared layout engine can place.
 *
 * A sheet is a grid, which is a table — so each one becomes a section of its
 * own, sized and oriented to suit its own width, and the existing layout pass
 * handles pagination, row splitting and repeated borders from there.
 */
export async function extractWorkbook(buffer: ArrayBuffer): Promise<WordDocument> {
  const sheets = await readWorkbook(buffer);
  const named = sheets.length > 1;
  const sections = sheets
    .map((sheet) => sectionFor(sheet, named))
    .filter((section): section is Section => section !== null);

  if (sections.length === 0) throw new ExcelError("This workbook has no data to convert.");
  return { sections };
}
