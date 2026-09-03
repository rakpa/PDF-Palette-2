import type { Box, PageLayout, ParagraphBox, TableBox } from "../pdf-to-word/layout";
import type { PdfLine, PdfSpan } from "../pdf-to-word/types";
import type {
  OutParagraph,
  OutRun,
  OutSlide,
  OutTable,
  OutTableCell,
  OutTextBox,
} from "./pptx-emit";

/** A text box gets a little slack, since PowerPoint re-wraps with its own metrics. */
const BOX_SLACK = 1.15;

function runsOfLine(line: PdfLine): OutRun[] {
  const runs: OutRun[] = [];
  let previous: PdfSpan | null = null;

  for (const span of line.spans) {
    if (!span.text) continue;
    const gap =
      previous && span.x - previous.xEnd > previous.spaceWidth * 0.3 ? " " : "";
    const run: OutRun = {
      text: gap + span.text,
      size: span.fontSize,
      bold: span.font.bold,
      italic: span.font.italic,
      color: span.color ?? "#000000",
    };

    const last = runs[runs.length - 1];
    // Merge neighbouring runs that look the same, so a paragraph does not
    // arrive as one run per glyph cluster.
    if (
      last &&
      last.size === run.size &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.color === run.color
    ) {
      last.text += run.text;
    } else {
      runs.push(run);
    }
    previous = span;
  }

  return runs;
}

function paragraphsOf(box: ParagraphBox): OutParagraph[] {
  const runs: OutRun[] = [];
  box.lines.forEach((line, index) => {
    const lineRuns = runsOfLine(line);
    if (index > 0 && lineRuns.length > 0 && runs.length > 0) {
      // Lines of one paragraph rejoin with a space; PowerPoint re-wraps them.
      lineRuns[0] = { ...lineRuns[0], text: ` ${lineRuns[0].text.replace(/^\s+/, "")}` };
    }
    runs.push(...lineRuns);
  });

  if (runs.length === 0) return [];
  const text = runs.map((run) => run.text).join("").trim();
  if (!text) return [];

  return [{ runs, align: box.align === "justify" ? "justify" : box.align }];
}

function cellParagraphs(boxes: Box[]): OutParagraph[] {
  const out: OutParagraph[] = [];
  for (const box of boxes) {
    if (box.kind === "paragraph") out.push(...paragraphsOf(box));
    else if (box.kind === "columns") for (const column of box.columns) out.push(...cellParagraphs(column));
  }
  return out;
}

function tableOf(box: TableBox): OutTable {
  const columnWidths = box.columnWidths.length
    ? box.columnWidths
    : [Math.max(1, box.rect.x1 - box.rect.x0)];

  const rows = box.rows.map((row) => {
    const cells: OutTableCell[] = [];
    for (const cell of row) {
      cells.push({
        paragraphs: cellParagraphs(cell.content),
        columnSpan: cell.columnSpan,
        rowSpan: cell.rowSpan,
        continued: false,
      });
      // A spanned cell still needs its covered columns present in the row.
      for (let extra = 1; extra < cell.columnSpan; extra++) {
        cells.push({ paragraphs: [], columnSpan: 1, rowSpan: 1, continued: true });
      }
    }
    return cells;
  });

  return {
    x: box.rect.x0,
    y: box.rect.y0,
    width: columnWidths.reduce((sum, width) => sum + width, 0),
    height: box.rowHeights.reduce((sum, height) => sum + height, 0) || box.rect.y1 - box.rect.y0,
    columnWidths,
    rowHeights: box.rowHeights.length ? box.rowHeights : box.rows.map(() => 18),
    rows,
  };
}

function collect(boxes: Box[], slide: OutSlide): void {
  for (const box of boxes) {
    if (box.kind === "paragraph") {
      const paragraphs = paragraphsOf(box);
      if (paragraphs.length === 0) continue;
      const width = Math.max(12, box.rect.x1 - box.rect.x0);
      const height = Math.max(box.fontSize * 1.2, box.rect.y1 - box.rect.y0);
      slide.texts.push({
        x: box.rect.x0,
        y: box.rect.y0,
        width,
        height: height * BOX_SLACK,
        paragraphs,
      } satisfies OutTextBox);
      continue;
    }
    if (box.kind === "table") {
      slide.tables.push(tableOf(box));
      continue;
    }
    if (box.kind === "image") {
      const rect = box.image.rect;
      slide.pictures.push({
        x: rect.x0,
        y: rect.y0,
        width: Math.max(1, rect.x1 - rect.x0),
        height: Math.max(1, rect.y1 - rect.y0),
        data: box.image.data,
        type: box.image.type,
      });
      continue;
    }
    if (box.kind === "columns") {
      for (const column of box.columns) collect(column, slide);
    }
  }
}

/**
 * Turn laid-out pages into slides.
 *
 * A slide is a canvas, which is what a PDF page already is — so unlike the
 * Word and Excel conversions, nothing has to be reflowed. Each paragraph
 * becomes a text box standing where it stood on the page, keeping its own
 * fonts, sizes and colours, and tables arrive as tables that can be edited.
 */
export function buildSlides(layouts: PageLayout[]): {
  slides: OutSlide[];
  width: number;
  height: number;
} {
  const slides = layouts.map((layout) => {
    const slide: OutSlide = { texts: [], pictures: [], tables: [] };
    collect(layout.header, slide);
    collect(layout.body, slide);
    collect(layout.footer, slide);
    return slide;
  });

  return {
    slides,
    width: layouts[0]?.width ?? 720,
    height: layouts[0]?.height ?? 540,
  };
}
