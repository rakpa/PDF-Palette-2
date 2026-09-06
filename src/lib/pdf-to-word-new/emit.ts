import { createPackage, escapeXml, XML_HEADER, type Part } from "../office/ooxml-write";
import {
  mergeSpans,
  type Box,
  type PageLayout,
  type ParagraphBox,
  type TableBox,
} from "../pdf-to-word/layout";
import type { PageContent, PdfImage, PdfRule, PdfSpan } from "../pdf-to-word/types";
import { fitLetterSpacing, fontMetrics } from "./measure";
import type { PaintedFill } from "./sample";

/**
 * Writing a Word package that reproduces the page rather than reflows it.
 *
 * The flow emitter next door hands Word a document and lets it decide where
 * everything lands. This one decides first: every block keeps the coordinates
 * the PDF drew it at. Paragraphs become page-anchored frames, tables become
 * absolutely positioned tables, painted rectangles and rules become shapes
 * behind the text, and pictures are anchored at their own rect. The page is
 * still made of real paragraphs, runs and table cells, so it stays editable —
 * it is only the placement that is pinned.
 */

const TWIP_PER_PT = 20;
const EMU_PER_PT = 12700;
const MIN_HALF_POINT = 2;
const MAX_HALF_POINT = 3276;
const TAB_MAX = 31680;
/** Word's "behind the text" band; later shapes sit in front of earlier ones. */
const Z_BASE = -251658240;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const V = "urn:schemas-microsoft-com:vml";
const O = "urn:schemas-microsoft-com:office:office";
const W10 = "urn:schemas-microsoft-com:office:word";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const CT = {
  document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  styles: "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
  settings: "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  header: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  footer: "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
};

/** One recognised line of a scanned page, in page points from the top-left. */
export type HiddenTextLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FidelityPage = {
  layout: PageLayout;
  content: PageContent;
  /** Full-page bitmap, used when the page carries no usable text layer. */
  pageImage: PdfImage | null;
  /** OCR result for a scanned page, written as hidden text over the bitmap. */
  hidden?: HiddenTextLine[];
  /** Painted areas with their colour read off the rendered page. */
  fills?: PaintedFill[];
  /** Rules with their colour read off the rendered page. */
  rules?: PdfRule[];
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

/** A length as VML wants it: points with two decimals. */
function vpt(value: number): string {
  return `${Math.round(value * 100) / 100}pt`;
}

function jc(align: ParagraphBox["align"]): string {
  if (align === "center") return "center";
  if (align === "right") return "right";
  if (align === "justify") return "both";
  return "left";
}

type Rel = { id: string; type: string; target: string; external?: boolean };

function relsXml(rels: Rel[]): string {
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

class Media {
  files: Array<{ path: string; data: Uint8Array }> = [];
  private n = 0;
  shapeId = 1000;

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
  constructor(
    readonly media: Media,
    readonly mediaTarget: (name: string) => string
  ) {}

  rel(type: string, target: string, external = false): string {
    this.relN += 1;
    const id = `rId${this.relN}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  image(data: Uint8Array, type: "png" | "jpg"): string {
    return this.rel(`${REL}/image`, this.mediaTarget(this.media.add(data, type)));
  }
}

function textNode(text: string): string {
  const preserved = /^\s|\s$/.test(text);
  return `<w:t${preserved ? ' xml:space="preserve"' : ""}>${escapeXml(text)}</w:t>`;
}

/**
 * One run, with the width correction that keeps it as wide as the PDF drew it.
 * Word's own metrics are close but not identical to the embedded face, and the
 * drift compounds across a line; `w:spacing` takes it back out.
 */
function runXml(span: PdfSpan, lineFontSize: number, hidden: boolean): string {
  const size = span.vertAlign ? lineFontSize : span.fontSize;
  const family = span.font.family || "Calibri";
  const spacing = span.vertAlign
    ? 0
    : fitLetterSpacing(
        span.text,
        family,
        span.font.bold,
        span.font.italic,
        size,
        span.xEnd - span.x
      );
  const half = halfPoints(size);
  const color = span.color && span.color !== "000000" ? span.color : undefined;
  const rPr =
    `<w:rPr>` +
    `<w:rFonts w:ascii="${escapeXml(family)}" w:hAnsi="${escapeXml(family)}" w:cs="${escapeXml(family)}"/>` +
    `${span.font.bold ? "<w:b/><w:bCs/>" : ""}` +
    `${span.font.italic ? "<w:i/><w:iCs/>" : ""}` +
    `${span.strike ? "<w:strike/>" : ""}` +
    `${hidden ? "<w:vanish/>" : ""}` +
    `${color ? `<w:color w:val="${color}"/>` : ""}` +
    `${spacing ? `<w:spacing w:val="${signedTwip(spacing)}"/>` : ""}` +
    `<w:kern w:val="2"/>` +
    `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>` +
    `${span.underline ? '<w:u w:val="single"/>' : ""}` +
    `${span.vertAlign === "super" ? '<w:vertAlign w:val="superscript"/>' : ""}` +
    `${span.vertAlign === "sub" ? '<w:vertAlign w:val="subscript"/>' : ""}` +
    `</w:rPr>`;
  return `<w:r>${rPr}${textNode(span.text)}</w:r>`;
}

function runsFor(spans: PdfSpan[], lineFontSize: number, bag: Bag, hidden = false): string {
  let out = "";
  for (const span of mergeSpans(spans)) {
    if (!span.text) continue;
    const run = runXml(span, lineFontSize, hidden);
    out += span.link
      ? `<w:hyperlink r:id="${bag.rel(`${REL}/hyperlink`, span.link, true)}">${run}</w:hyperlink>`
      : run;
  }
  return out;
}

const PAGE_REFERENCE =
  /^(?:\d{1,4}|[ivxlcdm]{1,9})(?:\s*[,–—-]\s*(?:\d{1,4}|[ivxlcdm]{1,9}))*$/i;
const LEADER_ONLY = /^[\s.\u00b7\u2024\u2026]+$/;
const TRAILING_LEADER = /[\s.\u00b7\u2024\u2026]{3,}$/;

function segmentText(segment: ParagraphBox["segments"][number][number]): string {
  return segment.spans.map((span) => span.text).join("").trim();
}

function isIndexLine(segments: ParagraphBox["segments"][number]): boolean {
  return segments.length >= 2 && PAGE_REFERENCE.test(segmentText(segments[segments.length - 1]));
}

function withoutTrailingLeader(spans: PdfSpan[]): PdfSpan[] {
  const copy = spans.map((span) => ({ ...span }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if (!copy[i].text) continue;
    copy[i].text = copy[i].text.replace(TRAILING_LEADER, "");
    break;
  }
  return copy;
}

/**
 * A paragraph whose lines cannot be re-wrapped without moving text: anything
 * with an internal gap (tab stops), a centred or right-aligned block, or lines
 * that stop well short of the block edge.
 */
function needsHardBreaks(box: ParagraphBox): boolean {
  if (box.segments.some((line) => line.length > 1)) return true;
  if (box.lines.length < 2) return false;
  if (box.align === "center" || box.align === "right") return true;
  const width = Math.max(1, box.blockRight - box.blockLeft);
  const slack = Math.max(box.fontSize * 3, width * 0.08);
  return box.lines.slice(0, -1).some((line) => box.blockRight - line.xEnd > slack);
}

/** Join wrapped lines back into flowing text, undoing the PDF's hyphenation. */
function reflowSpans(box: ParagraphBox): PdfSpan[] {
  const out: PdfSpan[] = [];
  box.segments.forEach((lineSegments, lineIndex) => {
    const lineSpans = lineSegments.flatMap((segment) => segment.spans).map((span) => ({ ...span }));
    const firstText = lineSpans.find((span) => span.text.trim())?.text ?? "";
    const previous = [...out].reverse().find((span) => span.text.length > 0);
    if (lineIndex > 0 && previous && firstText) {
      if (/[a-z][-‐­]$/.test(previous.text) && /^[a-z]/.test(firstText.trimStart())) {
        previous.text = previous.text.replace(/[-‐­]$/, "");
      } else if (!/\s$/.test(previous.text) && !/^\s/.test(firstText)) {
        previous.text += " ";
      }
    }
    out.push(...lineSpans);
  });
  return out;
}

function paragraphChildren(
  box: ParagraphBox,
  leftEdge: number,
  bag: Bag,
  hidden: boolean
): { inner: string; tabs: string } {
  let inner = "";
  const stops = new Map<number, { type: "left" | "right"; leader: boolean }>();
  const measure = Math.max(1, box.blockRight - leftEdge);

  box.segments.forEach((segments, lineIndex) => {
    if (lineIndex > 0) inner += "<w:r><w:br/></w:r>";
    const indexLine = isIndexLine(segments);
    const pageIndex = segments.length - 1;
    const leaderIndexes = new Set<number>();
    if (indexLine) {
      for (let i = 1; i < pageIndex; i++) {
        if (LEADER_ONLY.test(segmentText(segments[i]))) leaderIndexes.add(i);
      }
    }
    const attachedLeader =
      indexLine && TRAILING_LEADER.test(segmentText(segments[Math.max(0, pageIndex - 1)]));

    segments.forEach((segment, segmentIndex) => {
      if (leaderIndexes.has(segmentIndex)) return;
      if (segmentIndex > 0) {
        const pageReference = indexLine && segmentIndex === pageIndex;
        const atRightEdge = pageReference ||
          segmentIndex === segments.length - 1 && box.blockRight - segment.xEnd <= 4;
        const position = atRightEdge
          ? signedTwip(pageReference ? segment.xEnd - leftEdge : measure)
          : Math.max(0, signedTwip(segment.x - leftEdge));
        const leader = pageReference && (leaderIndexes.size > 0 || attachedLeader);
        stops.set(Math.min(Math.max(0, position), TAB_MAX), {
          type: atRightEdge ? "right" : "left",
          leader,
        });
        inner += "<w:r><w:tab/></w:r>";
      }
      const spans =
        attachedLeader && segmentIndex === pageIndex - 1
          ? withoutTrailingLeader(segment.spans)
          : segment.spans;
      inner += runsFor(spans, box.fontSize, bag, hidden);
    });
  });

  const tabs = [...stops.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([position, stop]) =>
        `<w:tab w:val="${stop.type}"${stop.leader ? ' w:leader="dot"' : ""} w:pos="${position}"/>`
    )
    .join("");
  return { inner, tabs };
}

/** Line height in points, and the descent that sits below the last baseline. */
function metrics(box: ParagraphBox): { line: number; descent: number } {
  const size = Math.max(1, box.fontSize);
  const firstLine = box.lines[0];
  const span = firstLine?.spans.find((s) => s.text.trim()) ?? firstLine?.spans[0];
  const measured = span
    ? fontMetrics(span.font.family, span.font.bold, span.font.italic, size)
    : null;
  const descent = measured
    ? measured.descent
    : Math.abs(span?.font.descent ?? -0.22) * size;
  const line =
    box.lines.length > 1
      ? Math.max(box.leading, size * 1.0)
      : Math.max(box.leading, size * 1.2);
  return { line, descent };
}

/**
 * Where the frame's top edge has to sit for the first baseline to land where
 * the PDF put it. Word sets an exact line bottom-aligned in its line box, so
 * the baseline is one line height above the box's bottom, less the descent.
 */
function frameTop(box: ParagraphBox, line: number, descent: number): number {
  const baseline = box.lines[0]?.baseline;
  if (baseline === undefined) return Math.max(0, box.rect.y0);
  return Math.max(0, baseline - line + descent);
}

/**
 * A block of one line and one run cannot wrap, so its box can be the text
 * itself. That reproduces its position exactly, whatever alignment was
 * inferred for it — a centred line in a box a few points too wide lands a few
 * points off, and a running head or a page number is usually exactly that.
 */
function isSingleRun(box: ParagraphBox): boolean {
  return box.lines.length === 1 && box.segments.length === 1 && box.segments[0].length === 1;
}

/** Where a paragraph's own box sits on the page, and how wide it is. */
export function paragraphPlacement(
  box: ParagraphBox
): { x: number; y: number; width: number; height: number } {
  const { line, descent } = metrics(box);
  // A little slack absorbs the metric difference between the embedded face and
  // Word's, so the last word of a line is not pushed out of the box.
  const slack = box.align === "left" || isSingleRun(box) ? 2 : box.align === "justify" ? 1 : 0;
  const line0 = box.lines[0];
  const left = isSingleRun(box) && line0 ? line0.x : box.blockLeft;
  const right = isSingleRun(box) && line0 ? line0.xEnd : box.blockRight;
  return {
    x: Math.max(0, left),
    y: frameTop(box, line, descent),
    width: Math.max(6, right - left) + slack,
    height: Math.max(6, Math.max(1, box.lines.length) * line + descent),
  };
}

function paragraphXml(
  box: ParagraphBox,
  leftEdge: number,
  rightEdge: number,
  bag: Bag,
  framed: boolean,
  hidden = false
): string {
  // A frame is placed to the point, so its lines have to break where the PDF
  // broke them: a substituted face is a little narrower or wider, and letting
  // Word re-wrap inside the frame loses or gains a line.
  const hardBreaks = framed || needsHardBreaks(box);
  const source: ParagraphBox = hardBreaks
    ? box
    : {
        ...box,
        segments: [[{ spans: reflowSpans(box), x: box.blockLeft, xEnd: box.blockRight }]],
      };
  const { inner, tabs } = paragraphChildren(source, framed ? box.blockLeft : leftEdge, bag, hidden);
  const { line, descent } = metrics(box);

  let indentLeft = 0;
  let indentRight = 0;
  if (!framed) {
    const available = Math.max(1, rightEdge - leftEdge);
    indentLeft =
      box.align === "center" || box.align === "right" ? 0 : Math.max(0, box.blockLeft - leftEdge);
    indentRight =
      box.align === "center" || box.lines.length < 2 ? 0 : Math.max(0, rightEdge - box.blockRight);
    if (indentLeft + indentRight > available * 0.7) {
      const scale = (available * 0.7) / (indentLeft + indentRight);
      indentLeft *= scale;
      indentRight *= scale;
    }
  }

  const indents: string[] = [];
  if (indentLeft > 1) indents.push(`w:left="${twip(indentLeft)}"`);
  if (indentRight > 2) indents.push(`w:right="${twip(indentRight)}"`);
  if (box.firstLineIndent > 1) indents.push(`w:firstLine="${twip(box.firstLineIndent)}"`);
  if (box.hangingIndent > 1) indents.push(`w:hanging="${twip(box.hangingIndent)}"`);

  const pPr =
    `<w:pPr>` +
    `<w:widowControl w:val="0"/>` +
    `${box.shading && !framed ? `<w:shd w:val="clear" w:color="auto" w:fill="${box.shading}"/>` : ""}` +
    `${tabs ? `<w:tabs>${tabs}</w:tabs>` : ""}` +
    `<w:spacing w:before="${framed ? 0 : twip(box.spaceBefore)}" w:after="0" ` +
    `w:line="${twip(line)}" w:lineRule="exact"/>` +
    `${indents.length ? `<w:ind ${indents.join(" ")}/>` : ""}` +
    `<w:jc w:val="${framed && isSingleRun(box) ? "left" : jc(box.align)}"/>` +
    `</w:pPr>`;
  return `<w:p>${pPr}${inner || "<w:r><w:t></w:t></w:r>"}</w:p>`;
}

/** A painted rectangle, kept behind the text as a VML shape. */
function rectShapeXml(
  media: Media,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  z: number,
  gradient?: { color2: string; angle: number }
): string {
  const id = media.shapeId++;
  const style =
    `position:absolute;margin-left:${vpt(x)};margin-top:${vpt(y)};` +
    `width:${vpt(Math.max(0.25, width))};height:${vpt(Math.max(0.25, height))};` +
    `z-index:${z};mso-position-horizontal-relative:page;mso-position-vertical-relative:page`;
  const body = gradient
    ? `><v:fill type="gradient" color="#${color}" color2="#${gradient.color2}" ` +
      `angle="${gradient.angle}"/></v:rect>`
    : `/>`;
  return (
    `<w:r><w:pict>` +
    `<v:rect id="shape${id}" o:spid="_x0000_s${id}" style="${escapeXml(style)}" ` +
    `fillcolor="#${color}" stroked="f" o:allowincell="f"${body}` +
    `</w:pict></w:r>`
  );
}

function fillShapeXml(media: Media, fill: PaintedFill, z: number): string {
  return rectShapeXml(
    media,
    fill.rect.x0,
    fill.rect.y0,
    fill.rect.x1 - fill.rect.x0,
    fill.rect.y1 - fill.rect.y0,
    fill.color,
    z,
    fill.color2 ? { color2: fill.color2, angle: fill.angle ?? 0 } : undefined
  );
}

/** Rules are drawn as thin rectangles: one shape covers both orientations. */
function ruleShapeXml(media: Media, rule: PdfRule, z: number): string {
  const thickness = Math.max(0.4, rule.thickness);
  const x = rule.horizontal ? rule.start : rule.pos - thickness / 2;
  const y = rule.horizontal ? rule.pos - thickness / 2 : rule.start;
  const width = rule.horizontal ? rule.end - rule.start : thickness;
  const height = rule.horizontal ? thickness : rule.end - rule.start;
  return rectShapeXml(media, x, y, width, height, rule.color || "000000", z);
}

function graphicXml(rId: string, id: number, cx: number, cy: number): string {
  return (
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">` +
    `<pic:pic xmlns:pic="${PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>`
  );
}

/** A picture pinned to its own rectangle on the page, behind the text. */
function anchoredPictureXml(bag: Bag, image: PdfImage, z: number): string {
  const rId = bag.image(image.data, image.type);
  const id = bag.media.shapeId++;
  const cx = emu(Math.max(1, image.rect.x1 - image.rect.x0));
  const cy = emu(Math.max(1, image.rect.y1 - image.rect.y0));
  return (
    `<w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${z}" ` +
    `behindDoc="1" locked="0" layoutInCell="0" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(Math.max(0, image.rect.x0))}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(Math.max(0, image.rect.y0))}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    graphicXml(rId, id, cx, cy) +
    `</wp:anchor></w:drawing></w:r>`
  );
}

/**
 * A block pinned to the page as a text box.
 *
 * `w:framePr` says the same thing in a quarter of the XML, but readers treat
 * frames unevenly — LibreOffice ignores them outright inside a header or
 * footer — while a `wps` text box is what Word itself writes for placed text
 * and is honoured everywhere. The box has no fill, no outline and no internal
 * padding, so only its contents show, and it grows down from a fixed top.
 */
function textBoxXml(
  media: Media,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
  inner: string
): string {
  const id = media.shapeId++;
  const cx = emu(Math.max(6, width));
  const cy = emu(Math.max(6, height));
  return (
    `<w:r><w:drawing>` +
    `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${z}" ` +
    `behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(Math.max(0, x))}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(Math.max(0, y))}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="Text ${id}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${A}"><a:graphicData uri="${WPS}">` +
    `<wps:wsp xmlns:wps="${WPS}"><wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>` +
    `<wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" ` +
    `anchor="t" anchorCtr="0"><a:spAutoFit/></wps:bodyPr>` +
    `</wps:wsp></a:graphicData></a:graphic>` +
    `</wp:anchor></w:drawing></w:r>`
  );
}

/** A picture in normal flow — used inside table cells and running heads. */
function inlinePictureXml(bag: Bag, image: PdfImage): string {
  const rId = bag.image(image.data, image.type);
  const id = bag.media.shapeId++;
  const cx = emu(Math.max(1, image.rect.x1 - image.rect.x0));
  const cy = emu(Math.max(1, image.rect.y1 - image.rect.y0));
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    graphicXml(rId, id, cx, cy) +
    `</wp:inline></w:drawing></w:r></w:p>`
  );
}

function borderXml(present: boolean, color = "8C8C8C"): string {
  return present ? `w:val="single" w:sz="4" w:space="0" w:color="${color}"` : `w:val="nil"`;
}

function spacerXml(height: number): string {
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" ` +
    `w:line="${Math.max(20, twip(height))}" w:lineRule="exact"/></w:pPr></w:p>`
  );
}

/**
 * A table at its own coordinates. Cell margins are zeroed so the paragraph
 * indents measured inside each cell put the text exactly where it was, and
 * the source column widths and row heights are written straight through.
 */
function tableXml(box: TableBox, bag: Bag, floating: boolean, leftEdge: number): string {
  const widths = box.columnWidths.map((w) => Math.max(1, twip(w)));
  const tableWidth = widths.reduce((a, b) => a + b, 0);
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
          `<w:tc><w:tcPr><w:tcW w:w="${Math.max(100, size)}" w:type="dxa"/>` +
          `${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}<w:vMerge/>` +
          `</w:tcPr><w:p/></w:tc>`;
        remaining[col] -= 1;
        col += span;
        continue;
      }
      const cell = cells[index++];
      if (!cell) break;
      const span = Math.max(1, cell.columnSpan || 1);
      const size = widths.slice(col, col + span).reduce((a, b) => a + b, 0) || 400;
      const vAlign =
        cell.verticalAlign === "top" ? "top" : cell.verticalAlign === "bottom" ? "bottom" : "center";
      const borders = box.bordered
        ? `<w:tcBorders><w:top ${borderXml(cell.borders.top)}/><w:left ${borderXml(cell.borders.left)}/>` +
          `<w:bottom ${borderXml(cell.borders.bottom)}/><w:right ${borderXml(cell.borders.right)}/></w:tcBorders>`
        : `<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>`;
      if (cell.rowSpan > 1) {
        remaining[col] = cell.rowSpan - 1;
        continueSpan[col] = span;
      }
      const inner = flowBoxes(cell.content, cell.rect.x0, cell.rect.x1, bag);
      cellsXml +=
        `<w:tc><w:tcPr><w:tcW w:w="${Math.max(100, size)}" w:type="dxa"/>` +
        `${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}` +
        `${cell.rowSpan > 1 ? `<w:vMerge w:val="restart"/>` : ""}` +
        borders +
        `${cell.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shading}"/>` : ""}` +
        `<w:vAlign w:val="${vAlign}"/>` +
        `</w:tcPr>${inner || "<w:p/>"}</w:tc>`;
      col += span;
    }
    const height = twip(box.rowHeights[r] ?? 0);
    rowsXml +=
      `<w:tr>` +
      (height > 0 ? `<w:trPr><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>` : "") +
      `${cellsXml}</w:tr>`;
  }

  const position = floating
    ? `<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" ` +
      `w:vertAnchor="page" w:horzAnchor="page" ` +
      `w:tblpX="${twip(Math.max(0, box.rect.x0))}" w:tblpY="${twip(Math.max(0, box.rect.y0))}"/>` +
      `<w:tblOverlap w:val="overlap"/>`
    : "";
  const indent = floating ? 0 : Math.max(0, box.rect.x0 - leftEdge);
  const nil = box.bordered
    ? ""
    : `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/>` +
      `<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>`;
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  return (
    `<w:tbl><w:tblPr>${position}` +
    `<w:tblW w:w="${tableWidth}" w:type="dxa"/>` +
    `${indent > 1 ? `<w:tblInd w:w="${twip(indent)}" w:type="dxa"/>` : ""}` +
    nil +
    `<w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>` +
    `<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>` +
    `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml}</w:tbl>` +
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`
  );
}

/** Normal flow, used inside table cells and in the running head and foot. */
function flowBoxes(boxes: Box[], leftEdge: number, rightEdge: number, bag: Bag): string {
  let out = "";
  for (const box of boxes) {
    switch (box.kind) {
      case "paragraph":
        out += paragraphXml(box, leftEdge, rightEdge, bag, false);
        break;
      case "table":
        if (box.spaceBefore > 1) out += spacerXml(box.spaceBefore);
        out += tableXml(box, bag, false, leftEdge);
        break;
      case "image":
        out += inlinePictureXml(bag, box.image);
        break;
      case "columns":
        for (const column of box.columns) out += flowBoxes(column, leftEdge, rightEdge, bag);
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

type Placed =
  | { kind: "paragraph"; box: ParagraphBox }
  | { kind: "table"; box: TableBox }
  | { kind: "image"; image: PdfImage };

/**
 * Column and spacer boxes only exist to make normal flow behave. Here every
 * box already carries page coordinates, so the tree is flattened and each
 * survivor is placed on its own.
 */
/**
 * A table is worth keeping as a table when the page draws it as one — its
 * rules and cell shading are part of the design and Word should own them.
 * A block the detector merely inferred from alignment (side-by-side columns,
 * a label list) carries no such marks, and its cells place more accurately as
 * ordinary frames than as rows with their own heights and vertical alignment.
 */
function isDrawnTable(box: TableBox): boolean {
  return box.bordered || box.rows.some((row) => row.some((cell) => cell.shading));
}

/**
 * Contents and index entries are independent rows in the PDF. Grouping them
 * into one multiline paragraph replaces their measured baseline gaps with one
 * uniform Word line height. Keep one frame per row so both vertical spacing
 * and indentation remain at the source coordinates.
 */
function splitIndexParagraph(box: ParagraphBox): ParagraphBox[] {
  if (box.lines.length < 2 || !box.segments.every(isIndexLine)) return [box];
  return box.lines.map((line, index) => ({
    ...box,
    lines: [line],
    segments: [box.segments[index]],
    rect: { x0: line.x, y0: line.yTop, x1: line.xEnd, y1: line.yBottom },
    blockLeft: line.x,
    blockRight: line.xEnd,
    align: "left",
    firstLineIndent: 0,
    hangingIndent: 0,
    leading: Math.max(line.yBottom - line.yTop, line.fontSize * 1.15),
    fontSize: line.fontSize,
    spaceBefore: 0,
    listMarker: undefined,
  }));
}

function flatten(boxes: Box[], out: Placed[] = []): Placed[] {
  for (const box of boxes) {
    if (box.kind === "paragraph") {
      for (const row of splitIndexParagraph(box)) out.push({ kind: "paragraph", box: row });
    }
    else if (box.kind === "image") out.push({ kind: "image", image: box.image });
    else if (box.kind === "columns") for (const column of box.columns) flatten(column, out);
    else if (box.kind === "table") {
      if (isDrawnTable(box)) out.push({ kind: "table", box });
      else for (const row of box.rows) for (const cell of row) flatten(cell.content, out);
    }
  }
  return out;
}

/**
 * Everything on a band, each piece pinned to where it was read: paragraphs as
 * page-anchored text boxes, drawn tables as positioned tables, pictures handed
 * to the caller so they can go behind the text.
 */
function placedBoxes(
  boxes: Box[],
  bag: Bag,
  z: () => number,
  picture: (image: PdfImage) => void
): { anchors: string; tables: string } {
  let anchors = "";
  let tables = "";
  for (const placed of flatten(boxes)) {
    if (placed.kind === "image") {
      picture(placed.image);
    } else if (placed.kind === "paragraph") {
      const { x, y, width, height } = paragraphPlacement(placed.box);
      anchors += textBoxXml(
        bag.media,
        x,
        y,
        width,
        height,
        z(),
        paragraphXml(placed.box, placed.box.blockLeft, placed.box.blockRight, bag, true)
      );
    } else {
      tables += tableXml(placed.box, bag, true, 0);
    }
  }
  return { anchors, tables };
}

/** Recognised text, written over the scan as hidden runs. */
function hiddenLineXml(media: Media, line: HiddenTextLine, z: number): string {
  const size = Math.max(4, Math.min(72, line.height * 0.86));
  const spacing = fitLetterSpacing(line.text, "Arial", false, false, size, line.width);
  const half = halfPoints(size);
  const paragraph =
    `<w:p><w:pPr>` +
    `<w:widowControl w:val="0"/>` +
    `<w:spacing w:before="0" w:after="0" w:line="${twip(size * 1.2)}" w:lineRule="exact"/>` +
    `</w:pPr><w:r><w:rPr>` +
    `<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:vanish/>` +
    `${spacing ? `<w:spacing w:val="${signedTwip(spacing)}"/>` : ""}` +
    `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>` +
    `</w:rPr>${textNode(line.text)}</w:r></w:p>`;
  return textBoxXml(
    media,
    line.x,
    line.y,
    Math.max(6, line.width) + 4,
    Math.max(6, size * 1.2),
    z,
    paragraph
  );
}

const ROMAN: Array<[string, number]> = [
  ["m", 1000], ["cm", 900], ["d", 500], ["cd", 400], ["c", 100], ["xc", 90],
  ["l", 50], ["xl", 40], ["x", 10], ["ix", 9], ["v", 5], ["iv", 4], ["i", 1],
];

function romanToInt(value: string): number {
  let rest = value.toLowerCase();
  let total = 0;
  for (const [token, amount] of ROMAN) {
    while (rest.startsWith(token)) {
      total += amount;
      rest = rest.slice(token.length);
    }
  }
  return rest.length === 0 ? total : 0;
}

function boxText(boxes: Box[]): string[] {
  const out: string[] = [];
  for (const box of boxes) {
    if (box.kind === "paragraph") {
      out.push(
        box.lines
          .map((line) => line.spans.map((span) => span.text).join(""))
          .join(" ")
          .trim()
      );
    } else if (box.kind === "columns") {
      for (const column of box.columns) out.push(...boxText(column));
    }
  }
  return out.filter(Boolean);
}

/**
 * The number the page shows for itself. A document that opens on roman
 * front matter, or that starts numbering at something other than 1, keeps
 * that scheme instead of being renumbered from the top.
 */
function pageNumbering(layout: PageLayout): { start: number; fmt: string } | null {
  for (const text of [...boxText(layout.footer), ...boxText(layout.header)]) {
    const token = text.replace(/^[\s|[\]()<>—–-]+|[\s|[\]()<>—–-]+$/g, "");
    const bare = token.replace(/^(?:page|p\.?)\s+/i, "").trim();
    if (/^\d{1,4}$/.test(bare)) {
      const value = Number(bare);
      if (value > 0) return { start: value, fmt: "decimal" };
    }
    if (/^[ivxlcdm]{1,9}$/i.test(bare)) {
      const value = romanToInt(bare);
      if (value > 0) {
        return { start: value, fmt: bare === bare.toLowerCase() ? "lowerRoman" : "upperRoman" };
      }
    }
  }
  return null;
}

function sectPrXml(
  layout: PageLayout,
  numbering: { start: number; fmt: string } | null,
  headerId?: string,
  footerId?: string
): string {
  const margins = layout.scanned
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : layout.margins;
  const landscape = layout.width > layout.height;
  return (
    `<w:sectPr>` +
    `${headerId ? `<w:headerReference w:type="default" r:id="${headerId}"/>` : ""}` +
    `${footerId ? `<w:footerReference w:type="default" r:id="${footerId}"/>` : ""}` +
    `<w:type w:val="nextPage"/>` +
    `<w:pgSz w:w="${twip(layout.width)}" w:h="${twip(layout.height)}"` +
    `${landscape ? ' w:orient="landscape"' : ""}/>` +
    `<w:pgMar w:top="${twip(margins.top)}" w:right="${twip(margins.right)}" ` +
    `w:bottom="${twip(margins.bottom)}" w:left="${twip(margins.left)}" ` +
    `w:header="${twip(layout.scanned ? 0 : layout.headerDistance)}" ` +
    `w:footer="${twip(layout.scanned ? 0 : layout.footerDistance)}" w:gutter="0"/>` +
    `${numbering ? `<w:pgNumType w:start="${numbering.start}" w:fmt="${numbering.fmt}"/>` : ""}` +
    `<w:cols w:space="0"/>` +
    `</w:sectPr>`
  );
}

function partRoot(tag: "w:document" | "w:hdr" | "w:ftr", inner: string): string {
  return (
    `${XML_HEADER}<${tag} xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" ` +
    `xmlns:pic="${PIC}" xmlns:v="${V}" xmlns:o="${O}" xmlns:w10="${W10}">` +
    (tag === "w:document" ? `<w:body>${inner}</w:body>` : inner) +
    `</${tag}>`
  );
}

const STYLES =
  `${XML_HEADER}<w:styles xmlns:w="${W}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>` +
  `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>` +
  `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>` +
  `</w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:qFormat/></w:style></w:styles>`;

const SETTINGS =
  `${XML_HEADER}<w:settings xmlns:w="${W}">` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" ` +
  `w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
  `</w:settings>`;

/** An empty paragraph that takes no room but can carry anchored objects. */
const ANCHOR_PPR =
  `<w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>`;

export async function writeFidelityDocument(pages: FidelityPage[]): Promise<Uint8Array> {
  const media = new Media();
  const doc = new Bag(media, (name) => `media/${name}`);
  const parts: Part[] = [];
  let body = "";
  let headerCount = 0;
  let footerCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const { layout, content, pageImage, hidden } = pages[i];
    const last = i === pages.length - 1;
    let z = 0;
    let front = 0;
    const nextZ = () => Z_BASE + z++;
    // Placed text sits in front of every painted area and picture.
    const nextFront = () => -Z_BASE + 1000 + front++;
    let background = "";
    let anchors = "";
    let tables = "";

    if (layout.scanned) {
      if (pageImage) {
        background += anchoredPictureXml(
          doc,
          { ...pageImage, rect: { x0: 0, y0: 0, x1: layout.width, y1: layout.height } },
          -nextZ()
        );
      }
      for (const line of hidden ?? []) anchors += hiddenLineXml(media, line, nextFront());
    } else {
      // Painted areas first, widest first, so a page-wide ground sits behind
      // the panels drawn on top of it and both sit behind the text.
      const fills = [...(pages[i].fills ?? content.fills)].sort(
        (a, b) =>
          (b.rect.x1 - b.rect.x0) * (b.rect.y1 - b.rect.y0) -
          (a.rect.x1 - a.rect.x0) * (a.rect.y1 - a.rect.y0)
      );
      for (const fill of fills) background += fillShapeXml(media, fill, nextZ());
      for (const rule of pages[i].rules ?? content.rules) {
        background += ruleShapeXml(media, rule, nextZ());
      }

      const placed = placedBoxes(layout.body, doc, nextFront, (image) => {
        background += anchoredPictureXml(doc, image, -nextZ());
      });
      anchors += placed.anchors;
      tables += placed.tables;
    }

    let headerId: string | undefined;
    let footerId: string | undefined;
    const band = (boxes: Box[], kind: "hdr" | "ftr") => {
      const count = kind === "hdr" ? (headerCount += 1) : (footerCount += 1);
      const file = `${kind === "hdr" ? "header" : "footer"}${count}.xml`;
      const bag = new Bag(media, (name) => `media/${name}`);
      // Anchored to the page, exactly as in the body: a running head sits
      // where the page drew it, not at an indent from the text margin.
      let pictures = "";
      let bandZ = 0;
      const placed = placedBoxes(boxes, bag, () => -Z_BASE + 1000 + bandZ++, (image) => {
        pictures += anchoredPictureXml(bag, image, 251658240);
      });
      const xml = partRoot(
        kind === "hdr" ? "w:hdr" : "w:ftr",
        `<w:p>${ANCHOR_PPR}${pictures}${placed.anchors}</w:p>${placed.tables}`
      );
      parts.push({
        path: `word/${file}`,
        data: xml,
        contentType: kind === "hdr" ? CT.header : CT.footer,
      });
      if (bag.rels.length > 0) {
        parts.push({ path: `word/_rels/${file}.rels`, data: relsXml(bag.rels) });
      }
      return doc.rel(`${REL}/${kind === "hdr" ? "header" : "footer"}`, file);
    };
    if (!layout.scanned && layout.header.length > 0) headerId = band(layout.header, "hdr");
    if (!layout.scanned && layout.footer.length > 0) footerId = band(layout.footer, "ftr");

    const sect = sectPrXml(layout, layout.scanned ? null : pageNumbering(layout), headerId, footerId);
    const pageXml = `<w:p>${ANCHOR_PPR}${background}${anchors}</w:p>${tables}`;
    // A section per page: the break lives in the last paragraph of the section,
    // except on the final page where it closes the body.
    body += last ? `${pageXml}${sect}` : `${pageXml}<w:p><w:pPr>${sect}</w:pPr></w:p>`;
  }

  parts.push({
    path: "_rels/.rels",
    data: relsXml([{ id: "rId1", type: `${REL}/officeDocument`, target: "word/document.xml" }]),
  });
  doc.rel(`${REL}/styles`, "styles.xml");
  doc.rel(`${REL}/settings`, "settings.xml");
  parts.push({
    path: "word/document.xml",
    data: partRoot("w:document", body),
    contentType: CT.document,
  });
  parts.push({ path: "word/_rels/document.xml.rels", data: relsXml(doc.rels) });
  parts.push({ path: "word/styles.xml", data: STYLES, contentType: CT.styles });
  parts.push({ path: "word/settings.xml", data: SETTINGS, contentType: CT.settings });
  for (const image of media.files) parts.push({ path: image.path, data: image.data });

  return createPackage(parts);
}
