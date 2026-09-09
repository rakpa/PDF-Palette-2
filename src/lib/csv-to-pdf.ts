import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 792; // landscape letter for tables
const PAGE_HEIGHT = 612;
const MARGIN = 36;
const FONT_SIZE = 9;
const ROW_H = 14;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.length) || rows.length === 0) rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function clip(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export async function csvToPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(8, "Reading CSV…");
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("This CSV file is empty.");

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push("");
    return copy.slice(0, colCount);
  });

  onProgress?.(25, "Laying out table…");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const usable = PAGE_WIDTH - MARGIN * 2;
  const colW = usable / colCount;
  const rowsPerPage = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN * 2) / ROW_H) - 1);

  // Keep header on every page when present.
  const header = normalized[0];
  const body = normalized.slice(1);
  const chunks: string[][][] = [];
  for (let i = 0; i < body.length; i += rowsPerPage) {
    chunks.push(body.slice(i, i + rowsPerPage));
  }
  if (chunks.length === 0) chunks.push([]);

  for (let c = 0; c < chunks.length; c++) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN - FONT_SIZE;
    const drawRow = (cells: string[], useBold: boolean) => {
      const f = useBold ? bold : font;
      for (let col = 0; col < colCount; col++) {
        const x = MARGIN + col * colW + 2;
        const label = clip(String(cells[col] ?? ""), f, FONT_SIZE, colW - 6);
        page.drawText(label, {
          x,
          y,
          size: FONT_SIZE,
          font: f,
          color: rgb(0.1, 0.1, 0.12),
        });
      }
      y -= ROW_H;
      page.drawLine({
        start: { x: MARGIN, y: y + ROW_H - 2 },
        end: { x: PAGE_WIDTH - MARGIN, y: y + ROW_H - 2 },
        thickness: 0.3,
        color: rgb(0.75, 0.75, 0.78),
      });
    };

    drawRow(header, true);
    for (const row of chunks[c]) drawRow(row, false);
    onProgress?.(30 + Math.round(((c + 1) / chunks.length) * 65), `Page ${c + 1} of ${chunks.length}…`);
  }

  onProgress?.(98, "Saving…");
  const saved = await pdf.save();
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.csv$/i, "") || "spreadsheet";
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}.pdf`,
  };
}
