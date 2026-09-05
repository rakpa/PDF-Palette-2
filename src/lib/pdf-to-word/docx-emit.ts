import {
  createPackage,
  escapeXml,
  XML_HEADER,
  type Part,
} from "../office/ooxml-write";
import { mergeSpans, type Box, type PageLayout, type ParagraphBox, type TableBox } from "./layout";
import type { PdfImage, PdfSpan } from "./types";

/**
 * Writing a Word package.
 *
 * Same shape as Word → PDF and the Excel/PowerPoint emitters: the layout is
 * already decided, and this step only serialises it. The `docx` Packer is not
 * used — it is what sat on "Building Word document…" and never came back.
 */

const TWIP_PER_PT = 20;
const EMU_PER_PT = 12700;
const MIN_HALF_POINT = 2;
const MAX_HALF_POINT = 3276;
const TAB_MAX = 31680;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const CT = {
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  settings: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  header: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  footer: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
};

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

function jc(align: ParagraphBox["align"]): string {
  if (align === "center") return "center";
  if (align === "right") return "right";
  if (align === "justify") return "both";
  return "left";
}

function relsXml(
  rels: Array<{ id: string; type: string; target: string; external?: boolean }>
): string {
  const entries = rels
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"${
          rel.external ? ' TargetMode="External"' : ""
        }/>`
    )
    .join("");
  return `${XML_HEADER}<Relationships xmlns="${PKG_REL}">${entries}</Relationships>`;
}

type Rel = { id: string; type: string; target: string; external?: boolean };

class Media {
  files: Array<{ path: string; data: Uint8Array }> = [];
  private n = 0;
  drawingId = 1;

  add(data: Uint8Array, type: "png" | "jpg"): string {
    this.n += 1;
    const name = `image${this.n}.${type === "jpg" ? "jpeg" : "png"}`;
    this.files.push({ path: `word/media/${name}`, data });
    return name;
  }
}

class Bag {
  rels: Rel[] = [];
  private relN = 0;
  constructor(readonly media: Media) {}

  rel(type: string, target: string, external = false): string {
    this.relN += 1;
    const id = `rId${this.relN}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  image(data: Uint8Array, type: "png" | "jpg"): string {
    return this.media.add(data, type);
  }
}

function textNode(text: string): string {
  const preserved = /^\s|\s$/.test(text);
  return `<w:t${preserved ? ' xml:space="preserve"' : ""}>${escapeXml(text)}</w:t>`;
}

function runXml(span: PdfSpan, lineFontSize: number): string {
  const size = halfPoints(span.vertAlign ? lineFontSize : span.fontSize);
  const family = escapeXml(span.font.family || "Calibri");
  const color = span.color && span.color !== "000000" ? span.color : undefined;
  const rPr =
    `<w:rPr>` +
    `<w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>` +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    `${span.font.bold ? "<w:b/><w:bCs/>" : ""}` +
    `${span.font.italic ? "<w:i/><w:iCs/>" : ""}` +
    `${color ? `<w:color w:val="${color}"/>` : ""}` +
    `${span.underline ? '<w:u w:val="single"/>' : ""}` +
    `${span.strike ? "<w:strike/>" : ""}` +
    `${span.vertAlign === "super" ? '<w:vertAlign w:val="superscript"/>' : ""}` +
    `${span.vertAlign === "sub" ? '<w:vertAlign w:val="subscript"/>' : ""}` +
    `</w:rPr>`;
  return `<w:r>${rPr}${textNode(span.text)}</w:r>`;
}

function hyperlinkXml(span: PdfSpan, lineFontSize: number, bag: Bag): string {
  const id = bag.rel(`${REL}/hyperlink`, span.link!, true);
  return `<w:hyperlink r:id="${id}">${runXml(span, lineFontSize)}</w:hyperlink>`;
}

function runsFor(spans: PdfSpan[], lineFontSize: number, bag: Bag): string {
  let out = "";
  for (const span of mergeSpans(spans)) {
    if (!span.text) continue;
    out += span.link ? hyperlinkXml(span, lineFontSize, bag) : runXml(span, lineFontSize);
  }
  return out;
}

function paragraphChildren(box: ParagraphBox, leftEdge: number, bag: Bag): { inner: string; tabs: string } {
  let inner = "";
  const stops = new Map<number, "left" | "right">();
  const measure = Math.max(1, box.blockRight - leftEdge);

  box.segments.forEach((segments, lineIndex) => {
    if (lineIndex > 0) inner += "<w:r><w:br/></w:r>";
    segments.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) {
        const atRightEdge =
          segmentIndex === segments.length - 1 && box.blockRight - segment.xEnd <= 4;
        const position = atRightEdge
          ? signedTwip(measure)
          : Math.max(0, signedTwip(segment.x - leftEdge));
        stops.set(Math.min(Math.max(0, position), TAB_MAX), atRightEdge ? "right" : "left");
        inner += "<w:r><w:tab/></w:r>";
      }
      inner += runsFor(segment.spans, box.fontSize, bag);
    });
  });

  const tabs = [...stops.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, type]) => `<w:tab w:val="${type}" w:pos="${position}"/>`)
    .join("");
  return { inner, tabs };
}

function needsHardBreaks(box: ParagraphBox): boolean {
  if (box.segments.some((line) => line.length > 1)) return true;
  if (box.lines.length < 2) return false;
  if (box.align === "center" || box.align === "right") return true;
  const width = Math.max(1, box.blockRight - box.blockLeft);
  const slack = Math.max(box.fontSize * 3, width * 0.08);
  return box.lines.slice(0, -1).some((line) => box.blockRight - line.xEnd > slack);
}

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

function paragraphXml(box: ParagraphBox, leftEdge: number, rightEdge: number, bag: Bag): string {
  const hardBreaks = needsHardBreaks(box);
  const source: ParagraphBox = hardBreaks
    ? box
    : {
        ...box,
        segments: [[{ spans: reflowSpans(box), x: box.blockLeft, xEnd: box.blockRight }]],
      };

  const { inner, tabs } = paragraphChildren(source, box.blockLeft, bag);
  const available = Math.max(1, rightEdge - leftEdge);
  let indentLeft = box.align === "center" || box.align === "right" ? 0 : Math.max(0, box.blockLeft - leftEdge);
  let indentRight =
    box.align === "center" || box.lines.length < 2 ? 0 : Math.max(0, rightEdge - box.blockRight);
  if (indentLeft + indentRight > available * 0.7) {
    const scale = (available * 0.7) / (indentLeft + indentRight);
    indentLeft *= scale;
    indentRight *= scale;
  }

  const line = Math.max(box.leading, box.fontSize * 1.02);
  // "atLeast" lets Word grow a line to suit its own font metrics, which is
  // exactly what must not happen: the leading here is the one measured from
  // the PDF's own baselines, and a substituted face with taller metrics would
  // push a few lines off every dense page. The page counts stop matching, and
  // the whole document drifts.
  const lineRule = "exact";
  const indents: string[] = [];
  if (indentLeft > 1) indents.push(`w:left="${twip(indentLeft)}"`);
  if (indentRight > 2) indents.push(`w:right="${twip(indentRight)}"`);
  if (box.firstLineIndent > 1) indents.push(`w:firstLine="${twip(box.firstLineIndent)}"`);
  if (box.hangingIndent > 1) indents.push(`w:hanging="${twip(box.hangingIndent)}"`);

  const pPr =
    `<w:pPr>` +
    `<w:widowControl w:val="0"/>` +
    `<w:spacing w:before="${twip(box.spaceBefore)}" w:after="0" w:line="${twip(line)}" w:lineRule="${lineRule}"/>` +
    `<w:jc w:val="${jc(box.align)}"/>` +
    `${tabs ? `<w:tabs>${tabs}</w:tabs>` : ""}` +
    `${indents.length ? `<w:ind ${indents.join(" ")}/>` : ""}` +
    `${box.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${box.shading}"/>` : ""}` +
    `</w:pPr>`;
  return `<w:p>${pPr}${inner || "<w:r><w:t></w:t></w:r>"}</w:p>`;
}

function drawingXml(
  bag: Bag,
  image: PdfImage,
  widthPt: number,
  heightPt: number,
  floating: boolean,
  mediaTarget: (name: string) => string
): string {
  const name = bag.image(image.data, image.type);
  const rId = bag.rel(`${REL}/image`, mediaTarget(name));
  const cx = emu(widthPt);
  const cy = emu(heightPt);
  const id = bag.media.drawingId++;
  const pic =
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>`;
  const extent =
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`;
  const docPr =
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    pic;

  if (!floating) {
    return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">${extent}${docPr}</wp:inline></w:drawing>`;
  }

  return (
    `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(image.rect.x0)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(image.rect.y0)}</wp:posOffset></wp:positionV>` +
    `${extent}<wp:wrapNone/>${docPr}` +
    `</wp:anchor></w:drawing>`
  );
}

function imageParagraphXml(
  image: PdfImage,
  spaceBefore: number,
  floating: boolean,
  bag: Bag,
  mediaTarget: (name: string) => string
): string {
  const width = Math.max(1, image.rect.x1 - image.rect.x0);
  const height = Math.max(1, image.rect.y1 - image.rect.y0);
  const indent = floating ? "" : `<w:ind w:left="${twip(Math.max(0, image.rect.x0))}"/>`;
  return (
    `<w:p><w:pPr>` +
    `<w:spacing w:before="${twip(spaceBefore)}" w:after="0" w:line="${twip(height)}" w:lineRule="exact"/>` +
    `${indent}</w:pPr>` +
    `<w:r>${drawingXml(bag, image, width, height, floating, mediaTarget)}</w:r></w:p>`
  );
}

function spacerXml(height: number): string {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, twip(height))}" w:lineRule="exact"/></w:pPr></w:p>`;
}

function borderXml(present: boolean, color = "8C8C8C"): string {
  return present
    ? `w:val="single" w:sz="4" w:space="0" w:color="${color}"`
    : `w:val="nil"`;
}

function tableXml(
  box: TableBox,
  leftEdge: number,
  availableWidth: number,
  bag: Bag,
  mediaTarget: (name: string) => string
): string {
  const total = box.columnWidths.reduce((a, b) => a + b, 0) || availableWidth;
  const scale = total > availableWidth ? availableWidth / total : 1;
  const widths = box.columnWidths.map((w) => Math.max(1, twip(w * scale)));
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const indent = Math.max(0, box.rect.x0 - leftEdge);
  const colCount = widths.length;

  const remaining: number[] = new Array(colCount).fill(0);
  const continueSpan: number[] = new Array(colCount).fill(1);
  let rowsXml = "";

  for (let r = 0; r < box.rows.length; r++) {
    const cells = box.rows[r];
    let col = 0;
    let index = 0;
    let cellsXml = "";
    while (col < colCount) {
      if (remaining[col] > 0) {
        const span = Math.max(1, continueSpan[col] || 1);
        const size = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
        cellsXml +=
          `<w:tc><w:tcPr><w:tcW w:w="${Math.max(200, size)}" w:type="dxa"/>` +
          `${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}` +
          `<w:vMerge/>` +
          `</w:tcPr><w:p/></w:tc>`;
        remaining[col] -= 1;
        col += span;
        continue;
      }
      const cell = cells[index++];
      if (!cell) break;
      const span = Math.max(1, cell.columnSpan || 1);
      const start = col;
      const size = widths
        .slice(start, start + span)
        .reduce((a, b) => a + b, widths[start] === undefined ? 400 : 0);
      const vAlign =
        cell.verticalAlign === "top" ? "top" : cell.verticalAlign === "bottom" ? "bottom" : "center";
      const borders = box.bordered
        ? `<w:tcBorders>` +
          `<w:top ${borderXml(cell.borders.top)}/>` +
          `<w:left ${borderXml(cell.borders.left)}/>` +
          `<w:bottom ${borderXml(cell.borders.bottom)}/>` +
          `<w:right ${borderXml(cell.borders.right)}/>` +
          `</w:tcBorders>`
        : `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;
      if (cell.rowSpan > 1) {
        remaining[start] = cell.rowSpan - 1;
        continueSpan[start] = span;
      }
      const inner = emitBoxes(cell.content, cell.rect.x0, cell.rect.x1, bag, mediaTarget, false);
      cellsXml +=
        `<w:tc><w:tcPr><w:tcW w:w="${Math.max(200, size)}" w:type="dxa"/>` +
        `${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}` +
        `${cell.rowSpan > 1 ? `<w:vMerge w:val="restart"/>` : ""}` +
        `<w:vAlign w:val="${vAlign}"/>${borders}` +
        `${cell.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading}"/>` : ""}` +
        `</w:tcPr>${inner || "<w:p/>"}</w:tc>`;
      col += span;
    }
    const height = twip(box.rowHeights[r] ?? 0);
    rowsXml +=
      `<w:tr>` +
      (height > 0 ? `<w:trPr><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>` : "") +
      `${cellsXml}</w:tr>`;
  }

  const nil = box.bordered
    ? ""
    : `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>`;
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  return (
    `<w:tbl><w:tblPr>` +
    `<w:tblW w:w="${tableWidth}" w:type="dxa"/>` +
    `<w:tblLayout w:type="fixed"/>` +
    `${indent > 1 ? `<w:tblInd w:w="${twip(indent)}" w:type="dxa"/>` : ""}` +
    `${nil}</w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>${rowsXml}</w:tbl>` +
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`
  );
}

function columnsTableXml(
  columns: Box[][],
  widths: number[],
  left: number,
  available: number,
  bag: Bag,
  mediaTarget: (name: string) => string
): string {
  const table: TableBox = {
    kind: "table",
    rows: [
      columns.map((content, index) => {
        const columnLeft = index === 0 ? left : left + widths.slice(0, index).reduce((a, b) => a + b, 0);
        return {
          content,
          rect: { x0: columnLeft, y0: 0, x1: columnLeft + widths[index], y1: 0 },
          columnSpan: 1,
          rowSpan: 1,
          verticalAlign: "top" as const,
          borders: { top: false, bottom: false, left: false, right: false },
        };
      }),
    ],
    columnWidths: widths,
    rowHeights: [0],
    rect: { x0: left, y0: 0, x1: left + widths.reduce((a, b) => a + b, 0), y1: 0 },
    spaceBefore: 0,
    bordered: false,
  };
  return tableXml(table, left, available, bag, mediaTarget);
}

function emitBoxes(
  boxes: Box[],
  leftEdge: number,
  rightEdge: number,
  bag: Bag,
  mediaTarget: (name: string) => string,
  floatImages: boolean
): string {
  let out = "";
  const available = Math.max(1, rightEdge - leftEdge);
  const first = boxes[0];
  if (first && first.kind === "paragraph" && first.spaceBefore > 2) {
    out += spacerXml(first.spaceBefore);
    first.spaceBefore = 0;
  }

  for (const box of boxes) {
    switch (box.kind) {
      case "paragraph":
        out += paragraphXml(box, leftEdge, rightEdge, bag);
        break;
      case "table":
        if (box.spaceBefore > 1) out += spacerXml(box.spaceBefore);
        out += tableXml(box, leftEdge, available, bag, mediaTarget);
        break;
      case "image":
        out += imageParagraphXml(box.image, box.spaceBefore, floatImages, bag, mediaTarget);
        break;
      case "columns":
        if (box.spaceBefore > 1) out += spacerXml(box.spaceBefore);
        out += columnsTableXml(box.columns, box.widths, box.rect.x0, available, bag, mediaTarget);
        break;
      case "spacer":
        out += spacerXml(box.height);
        break;
      default:
        break;
    }
  }
  return out;
}

function sectPrXml(
  layout: PageLayout,
  headerId?: string,
  footerId?: string
): string {
  return (
    `<w:sectPr>` +
    `${headerId ? `<w:headerReference w:type="default" r:id="${headerId}"/>` : ""}` +
    `${footerId ? `<w:footerReference w:type="default" r:id="${footerId}"/>` : ""}` +
    `<w:pgSz w:w="${twip(layout.width)}" w:h="${twip(layout.height)}"/>` +
    `<w:pgMar w:top="${twip(layout.margins.top)}" w:right="${twip(layout.margins.right)}" ` +
    `w:bottom="${twip(layout.margins.bottom)}" w:left="${twip(layout.margins.left)}" ` +
    `w:header="${twip(layout.headerDistance)}" w:footer="${twip(layout.footerDistance)}"/>` +
    `</w:sectPr>`
  );
}

function partRoot(tag: "w:document" | "w:hdr" | "w:ftr", inner: string): string {
  return (
    `${XML_HEADER}<${tag} xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}">` +
    (tag === "w:document" ? `<w:body>${inner}</w:body>` : inner) +
    `</${tag}>`
  );
}

const STYLES =
  `${XML_HEADER}<w:styles xmlns:w="${W}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>` +
  `</w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:qFormat/></w:style></w:styles>`;

const SETTINGS =
  `${XML_HEADER}<w:settings xmlns:w="${W}">` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
  `</w:settings>`;

export async function writeDocument(
  pages: Array<{ layout: PageLayout; pageImage: PdfImage | null }>
): Promise<Uint8Array> {
  const media = new Media();
  const doc = new Bag(media);
  const parts: Part[] = [];
  let body = "";
  let headerCount = 0;
  let footerCount = 0;

  const docMedia = (name: string) => `media/${name}`;

  for (let i = 0; i < pages.length; i++) {
    const { layout, pageImage } = pages[i];
    const last = i === pages.length - 1;
    let content: string;
    if (layout.scanned) {
      // Same as the previous Packer path: a 1pt paragraph holds a floating
      // full-page picture so Word does not treat the scan as a second page.
      content = pageImage
        ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>` +
          `<w:r>${drawingXml(
            doc,
            { ...pageImage, rect: { x0: 0, y0: 0, x1: layout.width, y1: layout.height } },
            layout.width,
            layout.height,
            true,
            docMedia
          )}</w:r></w:p>`
        : "<w:p/>";
    } else {
      const left = layout.margins.left;
      const right = layout.width - layout.margins.right;
      content = emitBoxes(layout.body, left, right, doc, docMedia, true) || "<w:p/>";
    }

    let headerId: string | undefined;
    let footerId: string | undefined;
    if (!layout.scanned && layout.header.length > 0) {
      headerCount += 1;
      const bag = new Bag(media);
      const left = layout.margins.left;
      const right = layout.width - layout.margins.right;
      const xml = partRoot(
        "w:hdr",
        emitBoxes(layout.header, left, right, bag, (name) => `media/${name}`, false) || "<w:p/>"
      );
      const file = `header${headerCount}.xml`;
      parts.push({ path: `word/${file}`, data: xml, contentType: CT.header });
      if (bag.rels.length > 0) {
        parts.push({ path: `word/_rels/${file}.rels`, data: relsXml(bag.rels) });
      }
      headerId = doc.rel(`${REL}/header`, file);
    }
    if (!layout.scanned && layout.footer.length > 0) {
      footerCount += 1;
      const bag = new Bag(media);
      const left = layout.margins.left;
      const right = layout.width - layout.margins.right;
      const xml = partRoot(
        "w:ftr",
        emitBoxes(layout.footer, left, right, bag, (name) => `media/${name}`, false) || "<w:p/>"
      );
      const file = `footer${footerCount}.xml`;
      parts.push({ path: `word/${file}`, data: xml, contentType: CT.footer });
      if (bag.rels.length > 0) {
        parts.push({ path: `word/_rels/${file}.rels`, data: relsXml(bag.rels) });
      }
      footerId = doc.rel(`${REL}/footer`, file);
    }

    const sect = sectPrXml(
      layout.scanned ? { ...layout, margins: { top: 0, right: 0, bottom: 0, left: 0 }, headerDistance: 0, footerDistance: 0 } : layout,
      headerId,
      footerId
    );
    body += last ? `${content}${sect}` : `${content}<w:p><w:pPr>${sect}</w:pPr></w:p>`;
  }

  const stylesId = doc.rel(`${REL}/styles`, "styles.xml");
  const settingsId = doc.rel(`${REL}/settings`, "settings.xml");
  void stylesId;
  void settingsId;

  parts.push({
    path: "_rels/.rels",
    data: relsXml([
      { id: "rId1", type: `${REL}/officeDocument`, target: "word/document.xml" },
    ]),
  });
  parts.push({
    path: "word/document.xml",
    data: partRoot("w:document", body),
    contentType: CT.document,
  });
  parts.push({
    path: "word/_rels/document.xml.rels",
    data: relsXml(doc.rels),
  });
  parts.push({ path: "word/styles.xml", data: STYLES, contentType: CT.styles });
  parts.push({ path: "word/settings.xml", data: SETTINGS, contentType: CT.settings });

  for (const image of media.files) {
    parts.push({ path: image.path, data: image.data });
  }

  return createPackage(parts);
}
