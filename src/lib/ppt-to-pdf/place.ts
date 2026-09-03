import { canEncode, foldPunctuation, pickFont, widthOf, type FontSet } from "../office/fonts";
import type { PlacedPage, PlacedRect, PlacedSpan, RunStyle } from "../office/types";
import type { Presentation, RunFormat, Shape, TextBody, TextParagraph } from "./types";

/** PowerPoint indents each bullet level by about a quarter inch. */
const LEVEL_INDENT = 22;
const BULLET_GAP = 8;
/** Ascent as a share of the em box, matching the shared layout engine. */
const ASCENT = 0.8;
const LINE_HEIGHT = 1.2;

function toRunStyle(format: RunFormat): RunStyle {
  return {
    family: format.family,
    fontSize: format.size,
    bold: format.bold,
    italic: format.italic,
    underline: format.underline,
    strike: format.strike,
    color: format.color,
  };
}

interface Word {
  text: string;
  style: RunStyle;
  width: number;
  space: number;
}

/** Split a paragraph's runs into words, each measured in its own font. */
function measureWords(paragraph: TextParagraph, fonts: FontSet): Word[][] {
  const lines: Word[][] = [[]];

  for (const run of paragraph.runs) {
    const style = toRunStyle(run.format);
    const font = pickFont(fonts, style);

    for (const segment of run.text.split("\n")) {
      if (segment !== run.text.split("\n")[0]) lines.push([]);
      for (const word of segment.split(/(\s+)/)) {
        if (!word) continue;
        if (/^\s+$/.test(word)) continue;
        const text = canEncode(font, word) ? word : foldPunctuation(word);
        lines[lines.length - 1].push({
          text,
          style,
          width: widthOf(font, text, style.fontSize),
          space: widthOf(font, " ", style.fontSize),
        });
      }
    }
  }

  return lines;
}

interface Line {
  words: Word[];
  width: number;
  height: number;
}

function wrap(words: Word[], available: number, wrapText: boolean): Line[] {
  const lines: Line[] = [];
  let current: Word[] = [];
  let width = 0;

  const flush = () => {
    if (current.length === 0) return;
    lines.push({
      words: current,
      width,
      height: Math.max(...current.map((word) => word.style.fontSize)),
    });
    current = [];
    width = 0;
  };

  for (const word of words) {
    const gap = current.length > 0 ? word.space : 0;
    if (wrapText && current.length > 0 && width + gap + word.width > available) {
      flush();
      current = [word];
      width = word.width;
      continue;
    }
    current.push(word);
    width += gap + word.width;
  }
  flush();
  return lines;
}

function layoutText(
  body: TextBody,
  shape: Shape,
  fonts: FontSet,
  spans: PlacedSpan[]
): void {
  const left = shape.x + body.insets.left;
  const top = shape.y + body.insets.top;
  const boxWidth = Math.max(1, shape.width - body.insets.left - body.insets.right);
  const boxHeight = Math.max(1, shape.height - body.insets.top - body.insets.bottom);

  interface Block {
    line: Line;
    paragraph: TextParagraph;
    first: boolean;
    indent: number;
    bulletWidth: number;
  }

  const blocks: Block[] = [];
  let total = 0;

  for (const paragraph of body.paragraphs) {
    const indent = paragraph.level * LEVEL_INDENT;
    const bulletStyle = toRunStyle(paragraph.runs[0]?.format ?? {
      family: "Calibri", size: 18, bold: false, italic: false,
      underline: false, strike: false, color: "#000000",
    });
    const bulletWidth = paragraph.bullet
      ? widthOf(pickFont(fonts, bulletStyle), paragraph.bullet, bulletStyle.fontSize) + BULLET_GAP
      : 0;

    const available = Math.max(1, boxWidth - indent - bulletWidth);
    const paragraphLines = measureWords(paragraph, fonts).flatMap((words) =>
      words.length > 0 ? wrap(words, available, body.wrap) : [{ words: [], width: 0, height: bulletStyle.fontSize }]
    );

    total += paragraph.spaceBefore;
    paragraphLines.forEach((line, index) => {
      blocks.push({ line, paragraph, first: index === 0, indent, bulletWidth });
      total += line.height * LINE_HEIGHT * paragraph.lineSpacing;
    });
    total += paragraph.spaceAfter;
  }

  // Anchor the block of text inside the shape, the way PowerPoint does.
  let y =
    body.anchor === "center"
      ? top + Math.max(0, (boxHeight - total) / 2)
      : body.anchor === "bottom"
        ? top + Math.max(0, boxHeight - total)
        : top;

  for (const block of blocks) {
    if (block.first) y += block.paragraph.spaceBefore;

    const height = block.line.height * LINE_HEIGHT * block.paragraph.lineSpacing;
    const baseline = y + block.line.height * ASCENT;
    const contentWidth = boxWidth - block.indent - block.bulletWidth;
    const start = left + block.indent + block.bulletWidth;

    const slack = Math.max(0, contentWidth - block.line.width);
    let x =
      block.paragraph.align === "center"
        ? start + slack / 2
        : block.paragraph.align === "right"
          ? start + slack
          : start;

    if (block.first && block.paragraph.bullet && block.line.words.length > 0) {
      const style = block.line.words[0].style;
      spans.push({
        text: block.paragraph.bullet,
        x: x - block.bulletWidth,
        baseline,
        width: block.bulletWidth - BULLET_GAP,
        fontSize: style.fontSize,
        style,
      });
    }

    for (const word of block.line.words) {
      spans.push({
        text: word.text,
        x,
        baseline,
        width: word.width,
        fontSize: word.style.fontSize,
        style: word.style,
      });
      x += word.width + word.space;
    }

    y += height;
  }
}

function layoutTable(shape: Shape, fonts: FontSet, page: PlacedPage): void {
  const table = shape.table;
  if (!table) return;

  const totalWidth = table.columns.reduce((sum, width) => sum + width, 0) || shape.width;
  const scale = totalWidth > 0 ? shape.width / totalWidth : 1;

  let y = shape.y;
  for (const row of table.rows) {
    let x = shape.x;
    let column = 0;
    const height = row.height > 0 ? row.height : shape.height / Math.max(1, table.rows.length);

    for (const cell of row.cells) {
      let width = 0;
      for (let i = column; i < column + cell.span && i < table.columns.length; i++) {
        width += table.columns[i] * scale;
      }
      if (width <= 0) width = shape.width / Math.max(1, row.cells.length);

      if (!cell.merged) {
        page.rects.push({
          x,
          y,
          width,
          height,
          fill: cell.fill,
          stroke: "#9AA0A6",
          strokeWidth: 0.5,
        });
        if (cell.text) {
          layoutText(
            cell.text,
            { ...shape, x, y, width, height },
            fonts,
            page.spans
          );
        }
      }

      x += width;
      column += cell.span;
    }
    y += height;
  }
}

/**
 * Turn a presentation into pages ready to paint.
 *
 * Slides are absolutely positioned, so there is no flow to resolve — every
 * shape already knows where it sits. The work is inside the shapes: wrapping
 * each text body to its own box, anchoring it vertically, and hanging bullets
 * off the left of their indent level.
 */
export function placeSlides(presentation: Presentation, fonts: FontSet): PlacedPage[] {
  return presentation.slides.map((slide) => {
    const page: PlacedPage = {
      width: presentation.width,
      height: presentation.height,
      spans: [],
      images: [],
      rects: [],
      rules: [],
    };

    if (slide.background) {
      page.rects.push({
        x: 0,
        y: 0,
        width: presentation.width,
        height: presentation.height,
        fill: slide.background,
      });
    }

    for (const shape of slide.shapes) {
      if (shape.fill || shape.line) {
        const rect: PlacedRect = {
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          fill: shape.fill,
          stroke: shape.line?.color,
          strokeWidth: shape.line?.width,
        };
        page.rects.push(rect);
      }

      if (shape.picture) {
        page.images.push({
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
          data: shape.picture.data,
          type: shape.picture.type,
        });
      }

      if (shape.table) layoutTable(shape, fonts, page);
      if (shape.text) layoutText(shape.text, shape, fonts, page.spans);
    }

    return page;
  });
}
