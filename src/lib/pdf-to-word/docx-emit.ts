import {
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  Footer,
  Header,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Paragraph,
  ShadingType,
  Tab,
  TabStopPosition,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  UnderlineType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type IFloating,
  type TabStopDefinition,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import { mergeSpans, type Box, type PageLayout, type ParagraphBox, type TableBox } from "./layout";
import type { PdfImage, PdfSpan } from "./types";

const TWIP_PER_PT = 20;
const EMU_PER_PT = 12700;
const PX_PER_PT = 96 / 72;
/** Word rejects fonts below 1pt and above 1638pt. */
const MIN_HALF_POINT = 2;
const MAX_HALF_POINT = 3276;

function twip(pt: number): number {
  return Math.max(0, Math.round(pt * TWIP_PER_PT));
}

function signedTwip(pt: number): number {
  return Math.round(pt * TWIP_PER_PT);
}

function emu(pt: number): number {
  return Math.max(0, Math.round(pt * EMU_PER_PT));
}

function halfPoints(pt: number): number {
  return Math.max(MIN_HALF_POINT, Math.min(MAX_HALF_POINT, Math.round(pt * 2)));
}

function alignmentOf(box: ParagraphBox) {
  switch (box.align) {
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

function runsFor(spans: PdfSpan[], lineFontSize: number): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  for (const span of mergeSpans(spans)) {
    const text = span.text;
    if (!text) continue;
    // Super/subscript runs keep the line's size so Word scales them itself.
    const size = span.vertAlign ? lineFontSize : span.fontSize;
    const run = new TextRun({
      text,
      font: span.font.family,
      size: halfPoints(size),
      bold: span.font.bold || undefined,
      italics: span.font.italic || undefined,
      color: span.color && span.color !== "000000" ? span.color : undefined,
      underline: span.underline ? { type: UnderlineType.SINGLE } : undefined,
      strike: span.strike || undefined,
      superScript: span.vertAlign === "super" || undefined,
      subScript: span.vertAlign === "sub" || undefined,
    });
    children.push(
      span.link
        ? new ExternalHyperlink({ children: [run], link: span.link })
        : run
    );
  }
  return children;
}

/**
 * Build the children of one paragraph. Lines that carry wide internal gaps get
 * tab stops at the measured x positions, which is how Word reproduces things
 * like "title …………… page" or a header with a left and a right part.
 */
function paragraphChildren(
  box: ParagraphBox,
  leftEdge: number
): { children: ParagraphChild[]; tabStops: TabStopDefinition[] } {
  const children: ParagraphChild[] = [];
  const stops = new Map<number, (typeof TabStopType)[keyof typeof TabStopType]>();
  const measure = Math.max(1, box.blockRight - leftEdge);

  box.segments.forEach((segments, lineIndex) => {
    if (lineIndex > 0) children.push(new TextRun({ break: 1 }));
    segments.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) {
        // Wide internal gaps become real tab stops so columns inside a line
        // (a running head, a "chapter …… 12" entry) land where they did. A
        // segment that finishes at the measure gets a right tab instead of a
        // left one, or it would wrap the moment Word measures it wider.
        const atRightEdge =
          segmentIndex === segments.length - 1 && box.blockRight - segment.xEnd <= 4;
        const position = atRightEdge
          ? signedTwip(measure)
          : Math.max(0, signedTwip(segment.x - leftEdge));
        stops.set(
          Math.min(Math.max(0, position), TabStopPosition.MAX),
          atRightEdge ? TabStopType.RIGHT : TabStopType.LEFT
        );
        children.push(new TextRun({ children: [new Tab()] }));
      }
      children.push(...runsFor(segment.spans, box.fontSize));
    });
  });

  const tabStops: TabStopDefinition[] = [...stops.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, type]) => ({ type, position }));

  return { children, tabStops };
}

/**
 * A paragraph whose source lines each ended early is kept line-per-line with
 * explicit breaks; wrapped prose is allowed to reflow.
 */
function needsHardBreaks(box: ParagraphBox): boolean {
  // Tab-separated segments must survive, so they rule out reflow even for a
  // single line.
  if (box.segments.some((line) => line.length > 1)) return true;
  if (box.lines.length < 2) return false;
  if (box.align === "center" || box.align === "right") return true;
  const width = Math.max(1, box.blockRight - box.blockLeft);
  // A wrapped line ends at most one word short of the measure; anything that
  // stops earlier was a deliberate break.
  const slack = Math.max(box.fontSize * 3, width * 0.08);
  return box.lines.slice(0, -1).some((line) => box.blockRight - line.xEnd > slack);
}

function spacingFor(box: ParagraphBox) {
  const line = Math.max(box.leading, box.fontSize * 1.02);
  // EXACTLY keeps the original vertical rhythm; fall back to AT_LEAST when the
  // measured leading is too tight for the font, which Word would clip.
  const rule = box.leading >= box.fontSize * 1.18 ? LineRuleType.EXACTLY : LineRuleType.AT_LEAST;
  return {
    before: twip(box.spaceBefore),
    after: 0,
    line: twip(line),
    lineRule: rule,
  };
}

/**
 * Join a paragraph's lines back into one flow. A line break in a PDF is just a
 * position, so the word that ended the line needs its space back — and a word
 * the source hyphenated across the break has to be put together again, because
 * Word re-wraps the paragraph somewhere else entirely.
 */
function reflowSpans(box: ParagraphBox): PdfSpan[] {
  const out: PdfSpan[] = [];
  box.segments.forEach((lineSegments, lineIndex) => {
    const lineSpans = lineSegments.flatMap((segment) => segment.spans).map((span) => ({ ...span }));
    const firstText = lineSpans.find((span) => span.text.trim())?.text ?? "";
    const previous = [...out].reverse().find((span) => span.text.length > 0);

    if (lineIndex > 0 && previous && firstText) {
      if (/[a-z][-\u2010\u00ad]$/.test(previous.text) && /^[a-z]/.test(firstText.trimStart())) {
        previous.text = previous.text.replace(/[-\u2010\u00ad]$/, "");
      } else if (!/\s$/.test(previous.text) && !/^\s/.test(firstText)) {
        previous.text += " ";
      }
    }
    out.push(...lineSpans);
  });
  return out;
}

function paragraphFrom(box: ParagraphBox, leftEdge: number, rightEdge: number): Paragraph {
  const hardBreaks = needsHardBreaks(box);
  // Wrapped prose is handed to Word as one continuous run sequence so it can
  // re-wrap; anything else keeps its original line breaks.
  const source: ParagraphBox = hardBreaks
    ? box
    : {
        ...box,
        segments: [[{ spans: reflowSpans(box), x: box.blockLeft, xEnd: box.blockRight }]],
      };

  const { children, tabStops } = paragraphChildren(source, box.blockLeft);
  const available = Math.max(1, rightEdge - leftEdge);
  // Centred and right-aligned paragraphs are positioned by their alignment,
  // so adding the measured offset as an indent would shift them twice.
  let indentLeft = box.align === "center" || box.align === "right" ? 0 : Math.max(0, box.blockLeft - leftEdge);
  // A right indent narrows the measure, so it is only meaningful for a block
  // that actually wraps. Applying it to a single line would re-wrap text that
  // fitted perfectly well in the source.
  let indentRight =
    box.align === "center" || box.lines.length < 2 ? 0 : Math.max(0, rightEdge - box.blockRight);
  // Never let the indents eat the measure; a bad estimate would otherwise wrap
  // the paragraph one character per line.
  if (indentLeft + indentRight > available * 0.7) {
    const scale = (available * 0.7) / (indentLeft + indentRight);
    indentLeft *= scale;
    indentRight *= scale;
  }

  return new Paragraph({
    alignment: alignmentOf(box),
    spacing: spacingFor(box),
    // Widow/orphan control would push the last lines of a paragraph onto the
    // next page, which is exactly the drift this converter is trying to avoid.
    widowControl: false,
    tabStops: tabStops.length > 0 ? tabStops : undefined,
    shading: box.shading
      ? { type: ShadingType.CLEAR, color: "auto", fill: box.shading }
      : undefined,
    indent: {
      left: indentLeft > 1 ? twip(indentLeft) : undefined,
      right: indentRight > 2 ? twip(indentRight) : undefined,
      firstLine: box.firstLineIndent > 1 ? twip(box.firstLineIndent) : undefined,
      hanging: box.hangingIndent > 1 ? twip(box.hangingIndent) : undefined,
    },
    children: children.length > 0 ? children : [new TextRun({ text: "" })],
  });
}

function floatingFor(image: PdfImage): IFloating {
  return {
    horizontalPosition: {
      relative: HorizontalPositionRelativeFrom.PAGE,
      offset: emu(image.rect.x0),
    },
    verticalPosition: {
      relative: VerticalPositionRelativeFrom.PAGE,
      offset: emu(image.rect.y0),
    },
    allowOverlap: true,
    behindDocument: false,
    wrap: { type: TextWrappingType.NONE },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

/**
 * Pictures are anchored at their exact page position and the flow reserves an
 * empty paragraph of the same height, so surrounding text keeps its place.
 */
function imageParagraph(image: PdfImage, spaceBefore: number, floating: boolean): Paragraph {
  const width = Math.max(1, image.rect.x1 - image.rect.x0);
  const height = Math.max(1, image.rect.y1 - image.rect.y0);
  return new Paragraph({
    spacing: {
      before: twip(spaceBefore),
      after: 0,
      line: twip(height),
      lineRule: LineRuleType.EXACTLY,
    },
    indent: floating ? undefined : { left: twip(Math.max(0, image.rect.x0)) },
    children: [
      new ImageRun({
        type: image.type,
        data: image.data,
        transformation: {
          width: Math.round(width * PX_PER_PT),
          height: Math.round(height * PX_PER_PT),
        },
        floating: floating ? floatingFor(image) : undefined,
      }),
    ],
  });
}

function borderOf(present: boolean, color = "8C8C8C") {
  return present
    ? { style: BorderStyle.SINGLE, size: 4, color }
    : { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
}

function tableFrom(box: TableBox, leftEdge: number, availableWidth: number): Table {
  const total = box.columnWidths.reduce((a, b) => a + b, 0) || availableWidth;
  const scale = total > availableWidth ? availableWidth / total : 1;
  const widths = box.columnWidths.map((w) => Math.max(1, twip(w * scale)));
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const indent = Math.max(0, box.rect.x0 - leftEdge);

  return new Table({
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    indent: indent > 1 ? { size: twip(indent), type: WidthType.DXA } : undefined,
    borders: box.bordered
      ? undefined
      : {
          top: borderOf(false),
          bottom: borderOf(false),
          left: borderOf(false),
          right: borderOf(false),
          insideHorizontal: borderOf(false),
          insideVertical: borderOf(false),
        },
    rows: box.rows.map(
      (cells, rowIndex) =>
        new TableRow({
          height: {
            value: twip(box.rowHeights[rowIndex] ?? 0),
            rule: HeightRule.ATLEAST,
          },
          children: cells.map((cell, index) => {
            const span = cell.columnSpan;
            const start = cells.slice(0, index).reduce((a, c) => a + c.columnSpan, 0);
            const size = widths
              .slice(start, start + span)
              .reduce((a, b) => a + b, widths[start] === undefined ? 400 : 0);
            return new TableCell({
              width: { size: Math.max(200, size), type: WidthType.DXA },
              columnSpan: span > 1 ? span : undefined,
              rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
              verticalAlign:
                cell.verticalAlign === "top"
                  ? VerticalAlign.TOP
                  : cell.verticalAlign === "bottom"
                    ? VerticalAlign.BOTTOM
                    : VerticalAlign.CENTER,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              shading: cell.shading
                ? { type: ShadingType.CLEAR, color: "auto", fill: cell.shading }
                : undefined,
              borders: box.bordered
                ? {
                    top: borderOf(cell.borders.top),
                    bottom: borderOf(cell.borders.bottom),
                    left: borderOf(cell.borders.left),
                    right: borderOf(cell.borders.right),
                  }
                : {
                    top: borderOf(false),
                    bottom: borderOf(false),
                    left: borderOf(false),
                    right: borderOf(false),
                  },
              children: cellChildren(cell.content, cell.rect.x0, cell.rect.x1),
            });
          }),
        })
    ),
  });
}

function cellChildren(content: Box[], leftEdge: number, rightEdge: number): Array<Paragraph | Table> {
  const children = emitBoxes(content, leftEdge, rightEdge, { floatImages: false });
  return children.length > 0 ? children : [new Paragraph({ children: [new TextRun({ text: "" })] })];
}

export function emitBoxes(
  boxes: Box[],
  leftEdge: number,
  rightEdge: number,
  options: { floatImages: boolean }
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const available = Math.max(1, rightEdge - leftEdge);

  // Word drops "space before" on the first paragraph of a page, so the gap
  // between the top margin and the first block is emitted as a real spacer.
  const first = boxes[0];
  if (first && first.kind === "paragraph" && first.spaceBefore > 2) {
    out.push(spacer(first.spaceBefore));
    first.spaceBefore = 0;
  }

  for (const box of boxes) {
    switch (box.kind) {
      case "paragraph":
        out.push(paragraphFrom(box, leftEdge, rightEdge));
        break;
      case "table":
        if (box.spaceBefore > 1) out.push(spacer(box.spaceBefore));
        out.push(tableFrom(box, leftEdge, available));
        // Word needs a paragraph after a table to keep it selectable.
        out.push(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACTLY }, children: [] }));
        break;
      case "image":
        out.push(imageParagraph(box.image, box.spaceBefore, options.floatImages));
        break;
      case "columns":
        if (box.spaceBefore > 1) out.push(spacer(box.spaceBefore));
        out.push(columnsTable(box.columns, box.widths, box.rect.x0, available));
        break;
      case "spacer":
        out.push(spacer(box.height));
        break;
      default:
        break;
    }
  }
  return out;
}

function spacer(height: number): Paragraph {
  return new Paragraph({
    spacing: {
      before: 0,
      after: 0,
      line: Math.max(20, twip(height)),
      lineRule: LineRuleType.EXACTLY,
    },
    children: [],
  });
}

/** Side-by-side content becomes a borderless table so the layout survives. */
function columnsTable(
  columns: Box[][],
  widths: number[],
  left: number,
  available: number
): Table {
  const total = widths.reduce((a, b) => a + b, 0) || available;
  const scale = total > available ? available / total : 1;
  const cellWidths = widths.map((w) => Math.max(400, twip(w * scale)));

  return new Table({
    width: { size: cellWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cellWidths,
    layout: TableLayoutType.FIXED,
    borders: {
      top: borderOf(false),
      bottom: borderOf(false),
      left: borderOf(false),
      right: borderOf(false),
      insideHorizontal: borderOf(false),
      insideVertical: borderOf(false),
    },
    rows: [
      new TableRow({
        children: columns.map((content, index) => {
          const columnLeft = index === 0 ? left : left + widths.slice(0, index).reduce((a, b) => a + b, 0);
          return new TableCell({
            width: { size: cellWidths[index], type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders: {
              top: borderOf(false),
              bottom: borderOf(false),
              left: borderOf(false),
              right: borderOf(false),
            },
            children: cellChildren(content, columnLeft, columnLeft + widths[index]),
          });
        }),
      }),
    ],
  });
}

export function sectionFor(layout: PageLayout, pageImage: PdfImage | null): ISectionOptions {
  if (layout.scanned) {
    return {
      properties: {
        page: {
          size: { width: twip(layout.width), height: twip(layout.height) },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 },
        },
      },
      children: pageImage
        ? [
            new Paragraph({
              spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACTLY },
              children: [
                new ImageRun({
                  type: pageImage.type,
                  data: pageImage.data,
                  transformation: {
                    width: Math.round(layout.width * PX_PER_PT),
                    height: Math.round(layout.height * PX_PER_PT),
                  },
                  floating: floatingFor({
                    ...pageImage,
                    rect: { x0: 0, y0: 0, x1: layout.width, y1: layout.height },
                  }),
                }),
              ],
            }),
          ]
        : [new Paragraph({ children: [new TextRun({ text: "" })] })],
    };
  }

  const left = layout.margins.left;
  const right = layout.width - layout.margins.right;
  const children = emitBoxes(layout.body, left, right, { floatImages: true });

  return {
    properties: {
      page: {
        size: { width: twip(layout.width), height: twip(layout.height) },
        margin: {
          top: twip(layout.margins.top),
          right: twip(layout.margins.right),
          bottom: twip(layout.margins.bottom),
          left: twip(layout.margins.left),
          header: twip(layout.headerDistance),
          footer: twip(layout.footerDistance),
        },
      },
    },
    headers:
      layout.header.length > 0
        ? { default: new Header({ children: emitBoxes(layout.header, left, right, { floatImages: false }) }) }
        : undefined,
    footers:
      layout.footer.length > 0
        ? { default: new Footer({ children: emitBoxes(layout.footer, left, right, { floatImages: false }) }) }
        : undefined,
    children: children.length > 0 ? children : [new Paragraph({ children: [new TextRun({ text: "" })] })],
  };
}
