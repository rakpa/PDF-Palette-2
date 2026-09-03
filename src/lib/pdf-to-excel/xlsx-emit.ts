import { createPackage, escapeXml, relationshipsXml, XML_HEADER, type Part } from "../office/ooxml-write";

/**
 * Writing a workbook.
 *
 * Only as much of SpreadsheetML as this conversion produces: inline strings
 * and real numbers, a handful of shared styles, column widths and merges.
 * Numbers are written as numbers rather than text, which is the whole point
 * of asking for a spreadsheet rather than a document.
 */

export interface OutCell {
  row: number;
  column: number;
  value: string;
  /** True when the value should land in the sheet as a number, not text. */
  numeric: boolean;
  bold: boolean;
  bordered: boolean;
  columnSpan: number;
  rowSpan: number;
}

export interface OutSheet {
  name: string;
  cells: OutCell[];
  /** Column widths in characters, indexed by column. */
  columnWidths: number[];
}

const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The four style permutations this emitter uses: bold and bordered. */
function styleIndex(cell: OutCell): number {
  return (cell.bold ? 1 : 0) + (cell.bordered ? 2 : 0);
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function stylesXml(): string {
  return (
    `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FFB0B0B0"/></left><right style="thin"><color rgb="FFB0B0B0"/></right>` +
    `<top style="thin"><color rgb="FFB0B0B0"/></top><bottom style="thin"><color rgb="FFB0B0B0"/></bottom><diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

function sheetXml(sheet: OutSheet): string {
  const byRow = new Map<number, OutCell[]>();
  for (const cell of sheet.cells) {
    const list = byRow.get(cell.row);
    if (list) list.push(cell);
    else byRow.set(cell.row, [cell]);
  }

  const cols = sheet.columnWidths.length
    ? `<cols>${sheet.columnWidths
        .map(
          (width, index) =>
            `<col min="${index + 1}" max="${index + 1}" width="${Math.max(
              4,
              Math.min(120, Number(width.toFixed(2)))
            )}" customWidth="1"/>`
        )
        .join("")}</cols>`
    : "";

  const rows = [...byRow.keys()]
    .sort((a, b) => a - b)
    .map((rowIndex) => {
      const cells = byRow
        .get(rowIndex)!
        .sort((a, b) => a.column - b.column)
        .map((cell) => {
          const ref = `${columnName(cell.column)}${rowIndex + 1}`;
          const style = styleIndex(cell);
          if (cell.numeric) {
            return `<c r="${ref}" s="${style}"><v>${cell.value}</v></c>`;
          }
          if (!cell.value) return `<c r="${ref}" s="${style}"/>`;
          return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            cell.value
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const merges = sheet.cells.filter((cell) => cell.columnSpan > 1 || cell.rowSpan > 1);
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((cell) => {
          const from = `${columnName(cell.column)}${cell.row + 1}`;
          const to = `${columnName(cell.column + cell.columnSpan - 1)}${cell.row + cell.rowSpan}`;
          return `<mergeCell ref="${from}:${to}"/>`;
        })
        .join("")}</mergeCells>`
    : "";

  return (
    `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${mergeXml}</worksheet>`
  );
}

export async function writeWorkbook(sheets: OutSheet[]): Promise<Uint8Array> {
  const used = new Set<string>();
  const names = sheets.map((sheet, index) => {
    // Excel rejects these characters in a sheet name, and caps it at 31.
    let name = (sheet.name || `Sheet${index + 1}`).replace(/[\\/*?:[\]]/g, " ").slice(0, 31).trim();
    if (!name) name = `Sheet${index + 1}`;
    let candidate = name;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${name.slice(0, 28)} ${suffix++}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });

  const workbook =
    `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="${REL_BASE}"><sheets>` +
    names
      .map(
        (name, index) =>
          `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      )
      .join("") +
    `</sheets></workbook>`;

  const workbookRels = relationshipsXml([
    ...names.map((_, index) => ({
      id: `rId${index + 1}`,
      type: `${REL_BASE}/worksheet`,
      target: `worksheets/sheet${index + 1}.xml`,
    })),
    {
      id: `rId${names.length + 1}`,
      type: `${REL_BASE}/styles`,
      target: "styles.xml",
    },
  ]);

  const parts: Part[] = [
    {
      path: "_rels/.rels",
      data: relationshipsXml([
        { id: "rId1", type: `${REL_BASE}/officeDocument`, target: "xl/workbook.xml" },
      ]),
    },
    {
      path: "xl/workbook.xml",
      data: workbook,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    },
    { path: "xl/_rels/workbook.xml.rels", data: workbookRels },
    {
      path: "xl/styles.xml",
      data: stylesXml(),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
    },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      data: sheetXml(sheet),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    })),
  ];

  return createPackage(parts);
}
