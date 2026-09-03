import type { Box, PageLayout, TableBox } from "../pdf-to-word/layout";
import type { PdfLine, PdfSpan } from "../pdf-to-word/types";
import type { OutCell, OutSheet } from "./xlsx-emit";

/**
 * An Excel column is measured in characters of the default font, which is
 * about 5.25 points wide at the 11pt Calibri a new workbook uses.
 */
const POINTS_PER_CHARACTER = 5.25;

/** Text that is a plain number, allowing thousands separators and a sign. */
const PLAIN_NUMBER = /^[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^[-+]?\d*\.?\d+$/;

function lineText(line: PdfLine): string {
  let out = "";
  let previous: PdfSpan | null = null;
  for (const span of line.spans) {
    if (previous && span.x - previous.xEnd > previous.spaceWidth * 0.3 && !/\s$/.test(out)) {
      out += " ";
    }
    out += span.text;
    previous = span;
  }
  return out;
}

function textOf(boxes: Box[]): string {
  const parts: string[] = [];
  for (const box of boxes) {
    if (box.kind === "paragraph") {
      const text = box.lines.map(lineText).join(" ").replace(/\s+/g, " ").trim();
      if (text) parts.push(text);
    } else if (box.kind === "table") {
      for (const row of box.rows) {
        for (const cell of row) {
          const text = textOf(cell.content);
          if (text) parts.push(text);
        }
      }
    } else if (box.kind === "columns") {
      for (const column of box.columns) {
        const text = textOf(column);
        if (text) parts.push(text);
      }
    }
  }
  return parts.join(" ").trim();
}

function makeCell(
  row: number,
  column: number,
  text: string,
  options: { bold?: boolean; bordered?: boolean; columnSpan?: number; rowSpan?: number } = {}
): OutCell {
  const trimmed = text.trim();
  // Only a bare number becomes a number. Anything carrying a unit — a currency
  // symbol, a percent sign — would change meaning without a matching format,
  // so it stays as the text the page actually showed.
  const numeric = PLAIN_NUMBER.test(trimmed) && trimmed.length < 16;
  return {
    row,
    column,
    value: numeric ? trimmed.replace(/,/g, "") : trimmed,
    numeric,
    bold: options.bold ?? false,
    bordered: options.bordered ?? false,
    columnSpan: options.columnSpan ?? 1,
    rowSpan: options.rowSpan ?? 1,
  };
}

interface Cursor {
  row: number;
  cells: OutCell[];
  widths: number[];
}

function noteWidth(cursor: Cursor, column: number, points: number): void {
  const characters = Math.max(6, points / POINTS_PER_CHARACTER);
  cursor.widths[column] = Math.max(cursor.widths[column] ?? 0, characters);
}

function writeTable(table: TableBox, cursor: Cursor): void {
  table.columnWidths.forEach((width, index) => noteWidth(cursor, index, width));

  table.rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row) {
      const text = textOf(cell.content);
      if (text || cell.borders.top || cell.borders.left) {
        cursor.cells.push(
          makeCell(cursor.row + rowIndex, column, text, {
            // A ruled table's first row is nearly always its header.
            bold: table.bordered && rowIndex === 0,
            bordered: table.bordered,
            columnSpan: cell.columnSpan,
            rowSpan: cell.rowSpan,
          })
        );
      }
      column += cell.columnSpan;
    }
  });

  cursor.row += table.rows.length;
}

function writeBoxes(boxes: Box[], cursor: Cursor): void {
  for (const box of boxes) {
    if (box.kind === "table") {
      writeTable(box, cursor);
      cursor.row += 1;
      continue;
    }
    if (box.kind === "columns") {
      // Side-by-side columns are stacked: a spreadsheet has no notion of a
      // page column, and reading order is what survives.
      for (const column of box.columns) writeBoxes(column, cursor);
      continue;
    }
    if (box.kind === "paragraph") {
      const text = box.lines.map(lineText).join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      cursor.cells.push(
        makeCell(cursor.row, 0, text, { bold: box.headingLevel !== undefined })
      );
      // Deliberately no width from a paragraph: a line of narrative is as wide
      // as the page, and letting it set column A would squash the tables.
      cursor.row += 1;
    }
  }
}

/**
 * Turn laid-out pages into sheets.
 *
 * One sheet per page, because a page is the unit a reader recognises and
 * tables from different pages rarely share a column grid. Tables land as
 * tables; the text around them keeps its reading order in the first column.
 */
export function buildSheets(layouts: PageLayout[]): OutSheet[] {
  return layouts.map((layout) => {
    const cursor: Cursor = { row: 0, cells: [], widths: [] };
    writeBoxes(layout.body, cursor);

    const widths: number[] = [];
    const columns = cursor.cells.reduce(
      (most, cell) => Math.max(most, cell.column + cell.columnSpan),
      0
    );
    for (let index = 0; index < columns; index++) {
      widths[index] = Math.min(80, cursor.widths[index] ?? 12);
    }

    return {
      name: `Page ${layout.pageNumber}`,
      cells: cursor.cells,
      columnWidths: widths,
    };
  });
}
