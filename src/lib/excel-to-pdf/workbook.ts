import type { BorderEdge, Borders } from "../office/types";
import { attr, descendants, kid, kids, numAttr, parseXml } from "../office/xml";
import { decodeUtf8, openZip, type ZipFile } from "../office/zip";
import { builtinFormat, formatCellValue } from "./number-format";

export interface CellFont {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
}

export interface CellStyle {
  font: CellFont;
  fill?: string;
  borders: Borders;
  horizontal?: "left" | "center" | "right";
  vertical: "top" | "center" | "bottom";
  wrap: boolean;
  numberFormat?: string;
}

export interface SheetCell {
  row: number;
  col: number;
  text: string;
  /** Numbers sit right by default, text sits left — as in the spreadsheet. */
  numeric: boolean;
  style: CellStyle;
}

export interface MergeRange {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface Sheet {
  name: string;
  cells: SheetCell[];
  /** Column widths in points, indexed by column. */
  columnWidths: number[];
  /** Row heights in points, indexed by row; undefined means automatic. */
  rowHeights: Array<number | undefined>;
  merges: MergeRange[];
  rowCount: number;
  columnCount: number;
  /** True when no cell in the sheet defines a border of its own. */
  bare: boolean;
}

export class ExcelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelError";
  }
}

const DEFAULT_FONT: CellFont = {
  family: "Calibri",
  size: 11,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "#000000",
};

/** The standard Office theme palette, for cells that colour by theme index. */
const THEME_COLORS = [
  "#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31",
  "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#0563C1", "#954F72",
];

/** Excel's indexed colour table still turns up in files written years ago. */
const INDEXED_COLORS = [
  "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
  "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF",
  "#800000", "#008000", "#000080", "#808000", "#800080", "#008080", "#C0C0C0", "#808080",
];

const BORDER_WIDTHS: Record<string, number> = {
  hair: 0.25,
  thin: 0.5,
  medium: 1,
  thick: 2,
  double: 1,
  dotted: 0.5,
  dashed: 0.5,
  dashDot: 0.5,
  dashDotDot: 0.5,
  mediumDashed: 1,
  mediumDashDot: 1,
  mediumDashDotDot: 1,
  slantDashDot: 1,
};

/** Lighten or darken a colour the way a theme tint does. */
function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const shifted = tint < 0 ? channel * (1 + tint) : channel * (1 - tint) + 255 * tint;
    return Math.max(0, Math.min(255, Math.round(shifted)));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function readColor(element: Element | undefined): string | undefined {
  if (!element) return undefined;
  const rgb = attr(element, "rgb");
  if (rgb) {
    // Written as ARGB, but the alpha byte carries no meaning here: writers
    // emit both "00RRGGBB" and "FFRRGGBB" for the same opaque colour, so
    // reading it as transparency loses every fill openpyxl and Excel write.
    return `#${(rgb.length === 8 ? rgb.slice(2) : rgb).toUpperCase()}`;
  }
  const theme = numAttr(element, "theme");
  if (theme !== undefined && THEME_COLORS[theme]) {
    return applyTint(THEME_COLORS[theme], numAttr(element, "tint") ?? 0);
  }
  const indexed = numAttr(element, "indexed");
  if (indexed !== undefined && INDEXED_COLORS[indexed]) return INDEXED_COLORS[indexed];
  return undefined;
}

function readBorderEdge(element: Element | undefined): BorderEdge | undefined {
  const style = attr(element, "style");
  if (!element || !style || style === "none") return undefined;
  return {
    color: readColor(kid(element, "color")) ?? "#000000",
    width: BORDER_WIDTHS[style] ?? 0.5,
  };
}

interface Styles {
  fonts: CellFont[];
  fills: Array<string | undefined>;
  borders: Borders[];
  formats: Map<number, string>;
  cellXfs: Array<{
    fontId: number;
    fillId: number;
    borderId: number;
    numFmtId: number;
    horizontal?: "left" | "center" | "right";
    vertical: "top" | "center" | "bottom";
    wrap: boolean;
  }>;
}

function parseStyles(xml: string | undefined): Styles {
  const styles: Styles = {
    fonts: [DEFAULT_FONT],
    fills: [undefined],
    borders: [{}],
    formats: new Map(),
    cellXfs: [],
  };
  if (!xml) return styles;

  const doc = parseXml(xml);
  const root = doc.documentElement;

  for (const format of descendants(root, "numFmt")) {
    const id = numAttr(format, "numFmtId");
    const code = attr(format, "formatCode");
    if (id !== undefined && code) styles.formats.set(id, code);
  }

  const fontList = kid(root, "fonts");
  if (fontList) {
    styles.fonts = kids(fontList).map((font) => ({
      family: attr(kid(font, "name"), "val") ?? attr(kid(font, "rFont"), "val") ?? DEFAULT_FONT.family,
      size: numAttr(kid(font, "sz"), "val") ?? DEFAULT_FONT.size,
      bold: !!kid(font, "b"),
      italic: !!kid(font, "i"),
      underline: !!kid(font, "u"),
      strike: !!kid(font, "strike"),
      color: readColor(kid(font, "color")) ?? DEFAULT_FONT.color,
    }));
  }

  const fillList = kid(root, "fills");
  if (fillList) {
    styles.fills = kids(fillList).map((fill) => {
      const pattern = kid(fill, "patternFill");
      const type = attr(pattern, "patternType");
      if (!pattern || !type || type === "none") return undefined;
      // A solid fill paints its foreground colour; other patterns approximate
      // to their background, which is what a reader mostly perceives.
      return type === "solid"
        ? readColor(kid(pattern, "fgColor"))
        : readColor(kid(pattern, "bgColor")) ?? readColor(kid(pattern, "fgColor"));
    });
  }

  const borderList = kid(root, "borders");
  if (borderList) {
    styles.borders = kids(borderList).map((border) => ({
      left: readBorderEdge(kid(border, "left")),
      right: readBorderEdge(kid(border, "right")),
      top: readBorderEdge(kid(border, "top")),
      bottom: readBorderEdge(kid(border, "bottom")),
    }));
  }

  const xfList = kid(root, "cellXfs");
  if (xfList) {
    styles.cellXfs = kids(xfList).map((xf) => {
      const alignment = kid(xf, "alignment");
      const horizontal = attr(alignment, "horizontal");
      const vertical = attr(alignment, "vertical");
      return {
        fontId: numAttr(xf, "fontId") ?? 0,
        fillId: numAttr(xf, "fillId") ?? 0,
        borderId: numAttr(xf, "borderId") ?? 0,
        numFmtId: numAttr(xf, "numFmtId") ?? 0,
        horizontal:
          horizontal === "center" || horizontal === "centerContinuous"
            ? "center"
            : horizontal === "right"
              ? "right"
              : horizontal === "left"
                ? "left"
                : undefined,
        vertical: vertical === "top" ? "top" : vertical === "center" ? "center" : "bottom",
        wrap: attr(alignment, "wrapText") === "1",
      };
    });
  }

  return styles;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const doc = parseXml(xml);
  return kids(doc.documentElement).map((item) =>
    descendants(item, "t")
      .map((node) => node.textContent ?? "")
      .join("")
  );
}

/** "BC12" → { col: 54, row: 11 }, both zero-based. */
function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const char of match[1]) col = col * 26 + (char.charCodeAt(0) - 64);
  return { col: col - 1, row: Number.parseInt(match[2], 10) - 1 };
}

/**
 * Excel measures columns in characters of the default font. The conversion to
 * pixels is the one Excel documents — a character plus the cell padding —
 * and points follow at 96 dpi.
 */
function columnWidthToPoints(characters: number): number {
  return (Math.round(characters * 7 + 5) * 72) / 96;
}

function parseSheet(xml: string, name: string, styles: Styles, shared: string[]): Sheet {
  const doc = parseXml(xml);
  const root = doc.documentElement;

  const formatDefaults = kid(root, "sheetFormatPr");
  const defaultColumnWidth = numAttr(formatDefaults, "defaultColWidth") ?? 8.43;
  const defaultRowHeight = numAttr(formatDefaults, "defaultRowHeight") ?? 15;

  const columnWidths: number[] = [];
  for (const col of descendants(kid(root, "cols"), "col")) {
    const from = numAttr(col, "min") ?? 1;
    const to = numAttr(col, "max") ?? from;
    const width = numAttr(col, "width");
    const hidden = attr(col, "hidden") === "1";
    for (let index = from - 1; index < to && index < 16384; index++) {
      columnWidths[index] = hidden ? 0 : columnWidthToPoints(width ?? defaultColumnWidth);
    }
  }

  const cells: SheetCell[] = [];
  const rowHeights: Array<number | undefined> = [];
  let rowCount = 0;
  let columnCount = 0;
  let bare = true;

  for (const row of descendants(kid(root, "sheetData"), "row")) {
    const rowNumber = (numAttr(row, "r") ?? rowHeights.length + 1) - 1;
    if (attr(row, "hidden") === "1") {
      rowHeights[rowNumber] = 0;
      continue;
    }
    const height = numAttr(row, "ht");
    if (height !== undefined) rowHeights[rowNumber] = height;

    for (const cell of kids(row)) {
      if (cell.localName !== "c") continue;
      const ref = attr(cell, "r");
      const at = ref ? parseRef(ref) : null;
      if (!at) continue;

      const type = attr(cell, "t");
      const styleIndex = numAttr(cell, "s") ?? 0;
      const xf = styles.cellXfs[styleIndex];

      let text = "";
      let numeric = false;

      if (type === "s") {
        const index = Number.parseInt(kid(cell, "v")?.textContent ?? "", 10);
        text = shared[index] ?? "";
      } else if (type === "inlineStr") {
        text = descendants(kid(cell, "is"), "t").map((n) => n.textContent ?? "").join("");
      } else if (type === "str") {
        text = kid(cell, "v")?.textContent ?? "";
      } else if (type === "b") {
        text = kid(cell, "v")?.textContent === "1" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        text = kid(cell, "v")?.textContent ?? "#ERROR";
      } else {
        const raw = kid(cell, "v")?.textContent;
        const value = raw === undefined || raw === "" ? Number.NaN : Number.parseFloat(raw);
        if (!Number.isNaN(value)) {
          numeric = true;
          const numFmtId = xf?.numFmtId ?? 0;
          const code = styles.formats.get(numFmtId) ?? builtinFormat(numFmtId);
          text = formatCellValue(value, code);
        }
      }

      // An empty cell still matters when it is filled or ruled — that is what
      // draws the rest of a bordered table's last row.
      if (!text && !xf?.fillId && !xf?.borderId) continue;

      const borders = styles.borders[xf?.borderId ?? 0] ?? {};
      if (borders.top || borders.right || borders.bottom || borders.left) bare = false;

      cells.push({
        row: at.row,
        col: at.col,
        text,
        numeric,
        style: {
          font: styles.fonts[xf?.fontId ?? 0] ?? DEFAULT_FONT,
          fill: styles.fills[xf?.fillId ?? 0],
          borders,
          horizontal: xf?.horizontal,
          vertical: xf?.vertical ?? "bottom",
          wrap: xf?.wrap ?? false,
          numberFormat: undefined,
        },
      });
      rowCount = Math.max(rowCount, at.row + 1);
      columnCount = Math.max(columnCount, at.col + 1);
    }
  }

  const merges: MergeRange[] = [];
  for (const merge of descendants(kid(root, "mergeCells"), "mergeCell")) {
    const ref = attr(merge, "ref");
    const [fromRef, toRef] = (ref ?? "").split(":");
    const from = fromRef ? parseRef(fromRef) : null;
    const to = toRef ? parseRef(toRef) : null;
    if (!from || !to) continue;
    merges.push({
      row: from.row,
      col: from.col,
      rows: to.row - from.row + 1,
      cols: to.col - from.col + 1,
    });
    rowCount = Math.max(rowCount, to.row + 1);
    columnCount = Math.max(columnCount, to.col + 1);
  }

  const fallbackWidth = columnWidthToPoints(defaultColumnWidth);
  for (let index = 0; index < columnCount; index++) {
    if (columnWidths[index] === undefined) columnWidths[index] = fallbackWidth;
  }
  for (let index = 0; index < rowCount; index++) {
    if (rowHeights[index] === undefined && defaultRowHeight !== 15) {
      rowHeights[index] = defaultRowHeight;
    }
  }

  return {
    name,
    cells,
    columnWidths: columnWidths.slice(0, columnCount),
    rowHeights: rowHeights.slice(0, rowCount),
    merges,
    rowCount,
    columnCount,
    bare,
  };
}

async function readText(zip: ZipFile, path: string): Promise<string | undefined> {
  const data = await zip.read(path);
  return data ? decodeUtf8(data) : undefined;
}

export async function readWorkbook(buffer: ArrayBuffer): Promise<Sheet[]> {
  let zip: ZipFile;
  try {
    zip = await openZip(buffer);
  } catch {
    throw new ExcelError("This file is not a readable .xlsx workbook.");
  }

  const workbookXml = await readText(zip, "xl/workbook.xml");
  if (!workbookXml) {
    throw new ExcelError("This file is not a readable .xlsx workbook.");
  }

  const relsXml = await readText(zip, "xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  if (relsXml) {
    for (const rel of descendants(parseXml(relsXml).documentElement, "Relationship")) {
      const id = attr(rel, "Id");
      const target = attr(rel, "Target");
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
  }

  const styles = parseStyles(await readText(zip, "xl/styles.xml"));
  const shared = parseSharedStrings(await readText(zip, "xl/sharedStrings.xml"));

  const sheets: Sheet[] = [];
  const entries = descendants(parseXml(workbookXml).documentElement, "sheet");

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (attr(entry, "state") === "hidden" || attr(entry, "state") === "veryHidden") continue;
    const name = attr(entry, "name") ?? `Sheet${index + 1}`;
    const relId =
      entry.getAttribute("r:id") ??
      entry.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ??
      undefined;
    const path = `xl/${(relId && targets.get(relId)) ?? `worksheets/sheet${index + 1}.xml`}`;
    const xml = await readText(zip, path);
    if (!xml) continue;
    sheets.push(parseSheet(xml, name, styles, shared));
  }

  if (sheets.length === 0) throw new ExcelError("This workbook has no visible sheets.");
  return sheets;
}
