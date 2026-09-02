import type { PDFFont } from "pdf-lib";
import { canEncode, foldPunctuation, pickFont, widthOf, type FontSet } from "./fonts";
import type {
  Block,
  Borders,
  Inline,
  ParagraphBlock,
  PlacedImage,
  PlacedPage,
  PlacedRect,
  PlacedRule,
  PlacedSpan,
  RunStyle,
  Section,
  TableBlock,
  WordDocument,
} from "./types";

type PageBuilder = {
  page: PlacedPage;
  y: number;
  contentTop: number;
  contentBottom: number;
  left: number;
  right: number;
};

function newPage(section: Section): PageBuilder {
  return {
    page: {
      width: section.width,
      height: section.height,
      spans: [],
      images: [],
      rects: [],
      rules: [],
    },
    y: section.margins.top,
    contentTop: section.margins.top,
    contentBottom: section.height - section.margins.bottom,
    left: section.margins.left,
    right: section.width - section.margins.right,
  };
}

function lineHeightFor(style: RunStyle, para: ParagraphBlock): number {
  const size = Math.max(1, style.fontSize);
  if (para.lineExact) return Math.max(size, para.line / 20);
  const factor = para.line > 0 ? para.line / 240 : 1.15;
  return size * Math.max(1, factor);
}

function paintHeaderFooter(target: PlacedPage, source: PlacedPage, yOffset: number): void {
  const shift = (n: number) => n + yOffset;
  for (const span of source.spans) {
    target.spans.push({ ...span, baseline: shift(span.baseline) });
  }
  for (const image of source.images) {
    target.images.push({ ...image, y: shift(image.y) });
  }
  for (const rect of source.rects) {
    target.rects.push({ ...rect, y: shift(rect.y) });
  }
  for (const rule of source.rules) {
    target.rules.push({ ...rule, y1: shift(rule.y1), y2: shift(rule.y2) });
  }
}

function layoutBand(blocks: Block[], section: Section, fonts: FontSet, top: number, maxHeight: number): PlacedPage {
  const bandSection: Section = {
    ...section,
    margins: { ...section.margins, top: 0, bottom: 0 },
    header: [],
    footer: [],
    body: blocks,
  };
  const builder = newPage(bandSection);
  builder.y = 0;
  builder.contentTop = 0;
  builder.contentBottom = Math.max(12, maxHeight);
  for (const block of blocks) layoutBlock(block, builder, bandSection, fonts, []);
  builder.page.width = section.width;
  builder.page.height = section.height;
  for (const span of builder.page.spans) span.baseline += top;
  for (const image of builder.page.images) image.y += top;
  for (const rect of builder.page.rects) rect.y += top;
  for (const rule of builder.page.rules) {
    rule.y1 += top;
    rule.y2 += top;
  }
  return builder.page;
}

type Token =
  | { kind: "text"; text: string; style: RunStyle; glue: boolean }
  | { kind: "image"; item: Extract<Inline, { kind: "image" }> }
  | { kind: "break"; break: "line" | "page" }
  | { kind: "tab" };

function tokenize(runs: Inline[]): Token[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    if (run.kind === "break" || run.kind === "tab" || run.kind === "image") {
      tokens.push(run.kind === "image" ? { kind: "image", item: run } : run);
      continue;
    }
    const folded = foldPunctuation(run.text);
    const parts = folded.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      tokens.push({
        kind: "text",
        text: part,
        style: run.style,
        glue: /^\s+$/.test(part),
      });
    }
  }
  return tokens;
}

function nextTab(x: number, left: number): number {
  const tab = 36;
  const rel = x - left;
  return left + (Math.floor(rel / tab) + 1) * tab;
}

function encodeRun(font: PDFFont, text: string): string {
  if (canEncode(font, text)) return text;
  let out = "";
  for (const ch of text) {
    out += canEncode(font, ch) ? ch : "?";
  }
  return out;
}

type LineSpan = {
  text: string;
  style: RunStyle;
  width: number;
  font: PDFFont;
  size: number;
};

function flushLine(
  builder: PageBuilder,
  line: LineSpan[],
  images: PlacedImage[],
  startX: number,
  maxWidth: number,
  align: ParagraphBlock["align"],
  height: number,
  last: boolean
): void {
  const contentWidth = line.reduce((sum, span) => sum + span.width, 0);
  let x = startX;
  if (align === "center") x += Math.max(0, (maxWidth - contentWidth) / 2);
  else if (align === "right") x += Math.max(0, maxWidth - contentWidth);
  else if (align === "justify" && !last && line.length > 1) {
    const gaps = line.filter((span) => /^\s+$/.test(span.text)).length;
    const extra = gaps > 0 ? Math.max(0, maxWidth - contentWidth) / gaps : 0;
    const baseline = builder.y + height * 0.8;
    for (const span of line) {
      const width = span.width + (/^\s+$/.test(span.text) ? extra : 0);
      if (span.text) {
        builder.page.spans.push({
          text: span.text,
          x,
          baseline,
          width,
          fontSize: span.size,
          style: span.style,
        });
        decorate(builder, span.style, x, baseline, width, span.size);
      }
      x += width;
    }
    for (const image of images) {
      image.x += startX === image.x ? 0 : 0;
      builder.page.images.push(image);
    }
    builder.y += height;
    return;
  }

  const baseline = builder.y + height * 0.8;
  for (const span of line) {
    if (span.text) {
      builder.page.spans.push({
        text: span.text,
        x,
        baseline,
        width: span.width,
        fontSize: span.size,
        style: span.style,
      });
      decorate(builder, span.style, x, baseline, span.width, span.size);
    }
    x += span.width;
  }
  for (const image of images) builder.page.images.push(image);
  builder.y += height;
}

function decorate(
  builder: PageBuilder,
  style: RunStyle,
  x: number,
  baseline: number,
  width: number,
  size: number
): void {
  const color = style.color;
  if (style.underline) {
    builder.page.rules.push({
      x1: x,
      y1: baseline + 1.2,
      x2: x + width,
      y2: baseline + 1.2,
      thickness: Math.max(0.4, size / 16),
      color,
    });
  }
  if (style.strike) {
    builder.page.rules.push({
      x1: x,
      y1: baseline - size * 0.3,
      x2: x + width,
      y2: baseline - size * 0.3,
      thickness: Math.max(0.4, size / 18),
      color,
    });
  }
}

function ensureRoom(builder: PageBuilder, section: Section, fonts: FontSet, pages: PlacedPage[], need: number): void {
  if (builder.y + need <= builder.contentBottom + 0.5) return;
  if (builder.y <= builder.contentTop + 0.5) return;
  finishPage(builder, section, fonts, pages);
}

function finishPage(builder: PageBuilder, section: Section, fonts: FontSet, pages: PlacedPage[]): void {
  stampChrome(builder.page, section, fonts);
  pages.push(builder.page);
  const next = newPage(section);
  builder.page = next.page;
  builder.y = next.y;
  builder.contentTop = next.contentTop;
  builder.contentBottom = next.contentBottom;
  builder.left = next.left;
  builder.right = next.right;
}

function stampChrome(page: PlacedPage, section: Section, fonts: FontSet): void {
  if (section.header.length) {
    const header = layoutBand(
      section.header,
      section,
      fonts,
      section.headerDistance,
      Math.max(12, section.margins.top - 4)
    );
    paintHeaderFooter(page, header, 0);
  }
  if (section.footer.length) {
    const probe = layoutBand(section.footer, section, fonts, 0, section.margins.bottom);
    let maxY = 0;
    for (const span of probe.spans) maxY = Math.max(maxY, span.baseline + 2);
    for (const image of probe.images) maxY = Math.max(maxY, image.y + image.height);
    const top = section.height - section.footerDistance - Math.max(maxY, 12);
    const footer = layoutBand(section.footer, section, fonts, Math.max(section.height - section.margins.bottom, top), section.margins.bottom);
    paintHeaderFooter(page, footer, 0);
  }
}

function layoutParagraph(
  para: ParagraphBlock,
  builder: PageBuilder,
  section: Section,
  fonts: FontSet,
  pages: PlacedPage[]
): void {
  const left = builder.left + para.indentLeft;
  const right = builder.right - para.indentRight;
  const first = left + para.indentFirst;
  const maxFirst = Math.max(24, right - first);
  const maxRest = Math.max(24, right - left);

  builder.y += para.spaceBefore;
  ensureRoom(builder, section, fonts, pages, 8);

  const tokens = tokenize(para.runs);
  let line: LineSpan[] = [];
  let images: PlacedImage[] = [];
  let lineWidth = 0;
  let lineHeight = 12;
  let firstLine = true;
  let xCursor = first;
  let maxWidth = maxFirst;

  if (para.numbering) {
    const style: RunStyle = para.runs.find((r): r is Extract<Inline, { kind: "text" }> => r.kind === "text")?.style ?? {
      family: "Calibri",
      fontSize: 11,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      color: "000000",
    };
    const font = pickFont(fonts, style);
    const text = encodeRun(font, foldPunctuation(para.numbering.text));
    const size = style.fontSize;
    const width = widthOf(font, text, size);
    const numberX = Math.max(builder.left, first - para.numbering.width);
    line.push({ text, style, width, font, size });
    lineWidth += width + 6;
    xCursor = Math.max(xCursor, numberX + width + 6);
    lineHeight = Math.max(lineHeight, lineHeightFor(style, para));
  }

  const flush = (last: boolean) => {
    if (line.length === 0 && images.length === 0) {
      if (last && firstLine) {
        const size = 11;
        ensureRoom(builder, section, fonts, pages, size * 1.15);
        builder.y += size * 1.15;
      }
      return;
    }
    ensureRoom(builder, section, fonts, pages, lineHeight);
    const startX = firstLine ? first : left;
    flushLine(builder, line, images, startX, firstLine ? maxFirst : maxRest, para.align, lineHeight, last);
    line = [];
    images = [];
    lineWidth = 0;
    lineHeight = 12;
    firstLine = false;
    xCursor = left;
    maxWidth = maxRest;
  };

  for (const token of tokens) {
    if (token.kind === "break") {
      if (token.break === "page") {
        flush(true);
        finishPage(builder, section, fonts, pages);
        firstLine = true;
        xCursor = first;
        maxWidth = maxFirst;
      } else {
        flush(false);
      }
      continue;
    }
    if (token.kind === "tab") {
      const next = nextTab(xCursor, left);
      const gap = Math.max(0, next - xCursor);
      line.push({
        text: " ",
        style: {
          family: "Calibri",
          fontSize: 11,
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          color: "000000",
        },
        width: gap,
        font: fonts.sans,
        size: 11,
      });
      lineWidth += gap;
      xCursor = next;
      continue;
    }
    if (token.kind === "image") {
      const item = token.item;
      let width = item.width;
      let height = item.height;
      const available = maxWidth;
      if (width > available) {
        const scale = available / width;
        width *= scale;
        height *= scale;
      }
      if (lineWidth + width > maxWidth && line.length) flush(false);
      ensureRoom(builder, section, fonts, pages, height);
      images.push({
        x: (firstLine ? first : left) + lineWidth,
        y: builder.y,
        width,
        height,
        data: item.data,
        type: item.type,
      });
      lineWidth += width;
      xCursor += width;
      lineHeight = Math.max(lineHeight, height);
      continue;
    }

    const style = token.style;
    const size = style.vertAlign ? style.fontSize * 0.7 : style.fontSize;
    const font = pickFont(fonts, style);
    const text = encodeRun(font, token.text);
    const width = widthOf(font, text, size);
    if (!token.glue && lineWidth + width > maxWidth && line.length) {
      while (line.length && /^\s+$/.test(line[line.length - 1].text)) {
        lineWidth -= line.pop()!.width;
      }
      flush(false);
    }
    if (!text && token.glue && line.length === 0) continue;
    line.push({ text, style, width, font, size });
    lineWidth += width;
    xCursor += width;
    lineHeight = Math.max(lineHeight, lineHeightFor(style, para));
  }
  flush(true);
  builder.y += para.spaceAfter;
}

function layoutTable(
  table: TableBlock,
  builder: PageBuilder,
  section: Section,
  fonts: FontSet,
  pages: PlacedPage[]
): void {
  const usable = builder.right - builder.left;
  const scale = table.width > usable && table.width > 0 ? usable / table.width : 1;
  const originX = builder.left + table.indent;

  const headerRows = table.rows.filter((row) => row.header);
  const rowHeight = (row: TableBlock["rows"][number]): number => {
    const padded = 4;
    const heights = row.cells.map((cell) => {
      if (cell.vMerge === "continue") return 0;
      const inner = measureBlocks(cell.blocks, Math.max(12, cell.width * scale - padded * 2), fonts);
      return Math.max(row.height ?? 0, inner + padded * 2);
    });
    return Math.max(row.height ?? 0, ...heights, 14);
  };
  const drawRow = (row: TableBlock["rows"][number], y: number, height: number): number => {
    const cellWidths = row.cells.map((cell) => cell.width * scale);
    const padded = 4;
    let x = originX;
    row.cells.forEach((cell, i) => {
      const width = cellWidths[i] || 80;
      if (cell.vMerge !== "continue") {
        if (cell.shading) {
          builder.page.rects.push({
            x,
            y,
            width,
            height,
            fill: cell.shading,
          });
        }
        strokeBox(builder.page, x, y, width, height, cell.borders, table.borders);
        const innerLeft = x + padded;
        const innerWidth = Math.max(8, width - padded * 2);
        const fakeSection: Section = {
          ...section,
          width: innerWidth + innerLeft,
          margins: { top: 0, right: 0, bottom: 0, left: innerLeft },
          header: [],
          footer: [],
          body: cell.blocks,
        };
        const innerBuilder: PageBuilder = {
          page: builder.page,
          y: y + padded,
          contentTop: y + padded,
          contentBottom: y + height + 10_000,
          left: innerLeft,
          right: innerLeft + innerWidth,
        };
        for (const block of cell.blocks) {
          layoutBlock(block, innerBuilder, fakeSection, fonts, pages);
        }
      }
      x += width;
    });
    return height;
  };

  for (const row of table.rows) {
    const height = rowHeight(row);
    if (builder.y + height > builder.contentBottom && builder.y > builder.contentTop + 1) {
      finishPage(builder, section, fonts, pages);
      for (const header of headerRows) {
        const hh = rowHeight(header);
        builder.y += drawRow(header, builder.y, hh);
      }
    }
    builder.y += drawRow(row, builder.y, height);
  }
  builder.y += 6;
}

function measureBlocks(blocks: Block[], width: number, fonts: FontSet): number {
  const section: Section = {
    width: width + 72,
    height: 10_000,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    headerDistance: 0,
    footerDistance: 0,
    header: [],
    footer: [],
    body: blocks,
  };
  const builder = newPage(section);
  builder.y = 0;
  builder.contentTop = 0;
  builder.contentBottom = 10_000;
  builder.left = 0;
  builder.right = width;
  for (const block of blocks) layoutBlock(block, builder, section, fonts, []);
  return Math.max(12, builder.y);
}

function strokeBox(page: PlacedPage, x: number, y: number, width: number, height: number, cell: Borders, table: Borders): void {
  const edge = (side: keyof Borders): { color: string; width: number } | undefined => cell[side] ?? table[side];
  const draw = (x1: number, y1: number, x2: number, y2: number, border?: { color: string; width: number }) => {
    if (!border) return;
    page.rules.push({ x1, y1, x2, y2, thickness: border.width, color: border.color });
  };
  draw(x, y, x + width, y, edge("top"));
  draw(x, y + height, x + width, y + height, edge("bottom"));
  draw(x, y, x, y + height, edge("left"));
  draw(x + width, y, x + width, y + height, edge("right"));
}

function layoutBlock(
  block: Block,
  builder: PageBuilder,
  section: Section,
  fonts: FontSet,
  pages: PlacedPage[]
): void {
  if (block.kind === "paragraph") layoutParagraph(block, builder, section, fonts, pages);
  else layoutTable(block, builder, section, fonts, pages);
}

export function layoutDocument(doc: WordDocument, fonts: FontSet): PlacedPage[] {
  const pages: PlacedPage[] = [];
  for (const section of doc.sections) {
    const builder = newPage(section);
    if (section.body.length === 0) {
      finishPage(builder, section, fonts, pages);
      continue;
    }
    for (const block of section.body) {
      layoutBlock(block, builder, section, fonts, pages);
    }
    if (builder.page.spans.length || builder.page.images.length || builder.page.rects.length || builder.y > builder.contentTop) {
      finishPage(builder, section, fonts, pages);
    } else if (pages.length === 0) {
      finishPage(builder, section, fonts, pages);
    }
  }
  return pages.length ? pages : [newPage(doc.sections[0] ?? emptySection()).page];
}

function emptySection(): Section {
  return {
    width: 612,
    height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    headerDistance: 36,
    footerDistance: 36,
    header: [],
    footer: [],
    body: [],
  };
}
