import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

const OPS = pdfjsLib.OPS;

const PT_TO_TWIP = 20;
const MIN_IMAGE_PT = 12;

type PdfSpan = {
  text: string;
  x: number;
  yTop: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
};

type PdfLine = {
  spans: PdfSpan[];
  yTop: number;
  x: number;
  xEnd: number;
  height: number;
  fontSize: number;
};

type PdfImage = {
  x: number;
  yTop: number;
  width: number;
  height: number;
  data: Uint8Array;
  type: "png" | "jpg";
};

type PageLayout = {
  width: number;
  height: number;
  lines: PdfLine[];
  images: PdfImage[];
  textChars: number;
};

function ptToTwip(pt: number): number {
  return Math.max(0, Math.round(pt * PT_TO_TWIP));
}

function mapFont(fontName: string, fontFamily: string): string {
  const raw = `${fontFamily} ${fontName}`.toLowerCase();
  if (/courier|mono|consolas|menlo|monaco|dejavu sans mono|lucida console|source code/.test(raw)) {
    return "Courier New";
  }
  if (/times|georgia|garamond|cambria|palatino|serif/.test(raw) && !/sans/.test(raw)) {
    return "Times New Roman";
  }
  if (/calibri/.test(raw)) return "Calibri";
  if (/cambria/.test(raw)) return "Cambria";
  if (/verdana/.test(raw)) return "Verdana";
  if (/tahoma/.test(raw)) return "Tahoma";
  if (/comic/.test(raw)) return "Comic Sans MS";
  if (/trebuchet/.test(raw)) return "Trebuchet MS";
  if (/garamond/.test(raw)) return "Garamond";
  if (/symbol/.test(raw)) return "Symbol";
  if (/wingding/.test(raw)) return "Wingdings";
  return "Arial";
}

function fontFlags(fontName: string, fontFamily: string): { bold: boolean; italic: boolean } {
  const raw = `${fontFamily} ${fontName}`.toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demibold|medium/.test(raw) && !/extralight/.test(raw),
    italic: /italic|oblique/.test(raw),
  };
}

function isTextItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
} {
  return Boolean(item && typeof item === "object" && "str" in item && "transform" in item);
}

function groupLines(spans: PdfSpan[]): PdfLine[] {
  if (spans.length === 0) return [];

  const sorted = [...spans].sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const lines: PdfLine[] = [];

  for (const span of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(2, span.fontSize * 0.35);
    if (last && Math.abs(span.yTop - last.yTop) <= tol) {
      last.spans.push(span);
      last.x = Math.min(last.x, span.x);
      last.xEnd = Math.max(last.xEnd, span.x + span.width);
      last.height = Math.max(last.height, span.height);
      last.fontSize = Math.max(last.fontSize, span.fontSize);
      last.yTop = Math.min(last.yTop, span.yTop);
    } else {
      lines.push({
        spans: [span],
        yTop: span.yTop,
        x: span.x,
        xEnd: span.x + span.width,
        height: span.height,
        fontSize: span.fontSize,
      });
    }
  }

  for (const line of lines) {
    line.spans.sort((a, b) => a.x - b.x);
  }
  return lines;
}

function mergeLineText(line: PdfLine): PdfSpan[] {
  const merged: PdfSpan[] = [];
  for (const span of line.spans) {
    const text = span.text.replace(/\s+/g, " ");
    if (!text) continue;
    const prev = merged[merged.length - 1];
    const sameStyle =
      prev &&
      prev.fontFamily === span.fontFamily &&
      prev.bold === span.bold &&
      prev.italic === span.italic &&
      Math.abs(prev.fontSize - span.fontSize) < 0.4;
    const gap = prev ? span.x - (prev.x + prev.width) : 0;
    if (sameStyle && gap >= -1 && gap < span.fontSize * 1.2) {
      const needSpace = gap > span.fontSize * 0.18 && !prev.text.endsWith(" ") && !text.startsWith(" ");
      prev.text += (needSpace ? " " : "") + text;
      prev.width = span.x + span.width - prev.x;
      prev.height = Math.max(prev.height, span.height);
    } else {
      merged.push({ ...span, text });
    }
  }
  return merged;
}

function lineAlignment(
  line: PdfLine,
  pageWidth: number,
  leftMargin: number,
  rightMargin: number
): (typeof AlignmentType)[keyof typeof AlignmentType] {
  const contentWidth = Math.max(1, pageWidth - leftMargin - rightMargin);
  const lineWidth = line.xEnd - line.x;
  const center = (line.x + line.xEnd) / 2;
  const pageCenter = pageWidth / 2;
  const rightEdge = pageWidth - rightMargin;
  const leftSlack = line.x - leftMargin;
  const rightSlack = rightEdge - line.xEnd;

  if (lineWidth > contentWidth * 0.82 && leftSlack < 18 && rightSlack < 18) {
    return AlignmentType.JUSTIFIED;
  }
  if (Math.abs(center - pageCenter) < 14 && leftSlack > 24 && rightSlack > 24) {
    return AlignmentType.CENTER;
  }
  if (rightSlack < 14 && leftSlack > contentWidth * 0.22) {
    return AlignmentType.RIGHT;
  }
  return AlignmentType.LEFT;
}

function pageMargins(lines: PdfLine[], pageWidth: number, pageHeight: number) {
  if (lines.length === 0) {
    return { left: 72, right: 72, top: 72, bottom: 72 };
  }
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.min(...lines.map((l) => Math.max(0, pageWidth - l.xEnd)));
  const top = Math.min(...lines.map((l) => l.yTop));
  const bottom = Math.min(
    ...lines.map((l) => Math.max(0, pageHeight - (l.yTop + l.height)))
  );
  return {
    left: Math.max(18, Math.min(108, left)),
    right: Math.max(18, Math.min(108, right)),
    top: Math.max(18, Math.min(108, top)),
    bottom: Math.max(18, Math.min(108, bottom)),
  };
}

function detectTableBlocks(lines: PdfLine[]): Array<{ start: number; end: number }> {
  const isRow = (line: PdfLine) => {
    if (line.spans.length < 2) return false;
    let gaps = 0;
    for (let i = 1; i < line.spans.length; i++) {
      const prev = line.spans[i - 1];
      const gap = line.spans[i].x - (prev.x + prev.width);
      if (gap > Math.max(12, line.fontSize * 1.6)) gaps += 1;
    }
    return gaps >= 1;
  };

  const flags = lines.map(isRow);
  const blocks: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < flags.length && flags[j]) j += 1;
    if (j - i >= 2) blocks.push({ start: i, end: j });
    i = j;
  }
  return blocks;
}

function splitRowCells(line: PdfLine): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.spans.length; i++) {
    const span = line.spans[i];
    if (i === 0) {
      current = span.text;
      continue;
    }
    const prev = line.spans[i - 1];
    const gap = span.x - (prev.x + prev.width);
    if (gap > Math.max(12, line.fontSize * 1.6)) {
      cells.push(current.trim());
      current = span.text;
    } else {
      const needSpace = gap > line.fontSize * 0.18 && !current.endsWith(" ");
      current += (needSpace ? " " : "") + span.text;
    }
  }
  if (current.trim()) cells.push(current.trim());
  return cells.length ? cells : [line.spans.map((s) => s.text).join(" ").trim()];
}

function makeRuns(spans: PdfSpan[]): TextRun[] {
  if (spans.length === 0) {
    return [new TextRun({ text: "" })];
  }
  return spans.map(
    (span) =>
      new TextRun({
        text: span.text,
        font: span.fontFamily,
        size: Math.max(16, Math.round(span.fontSize * 2)),
        bold: span.bold,
        italics: span.italic,
      })
  );
}

function lineToParagraph(
  line: PdfLine,
  prevYBottom: number | null,
  pageWidth: number,
  margins: { left: number; right: number; top: number; bottom: number }
): Paragraph {
  const spans = mergeLineText(line);
  const alignment = lineAlignment(line, pageWidth, margins.left, margins.right);
  const gap = prevYBottom == null ? 0 : Math.max(0, line.yTop - prevYBottom);
  const indent =
    alignment === AlignmentType.LEFT
      ? Math.max(0, line.x - margins.left)
      : 0;

  return new Paragraph({
    alignment,
    spacing: {
      before: ptToTwip(Math.min(24, gap)),
      after: 0,
      line: ptToTwip(Math.max(line.height, line.fontSize * 1.15)),
      lineRule: LineRuleType.AT_LEAST,
    },
    indent: indent > 1 ? { left: ptToTwip(indent) } : undefined,
    children: makeRuns(spans),
  });
}

function tableFromLines(lines: PdfLine[], pageWidth: number, leftMargin: number): Table {
  const rows = lines.map(splitRowCells);
  const colCount = Math.max(...rows.map((r) => r.length), 1);
  const padded = rows.map((r) => {
    const copy = [...r];
    while (copy.length < colCount) copy.push("");
    return copy;
  });
  const usable = Math.max(1200, ptToTwip(pageWidth - leftMargin * 2));
  const colWidth = Math.floor(usable / colCount);
  const border = {
    style: BorderStyle.SINGLE,
    size: 4,
    color: "BFBFBF",
  };

  return new Table({
    width: { size: usable, type: WidthType.DXA },
    columnWidths: Array.from({ length: colCount }, () => colWidth),
    rows: padded.map(
      (cells) =>
        new TableRow({
          children: cells.map(
            (text) =>
              new TableCell({
                width: { size: colWidth, type: WidthType.DXA },
                margins: { top: 40, bottom: 40, left: 60, right: 60 },
                verticalAlign: VerticalAlign.CENTER,
                borders: { top: border, bottom: border, left: border, right: border },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text, font: "Arial", size: 20 })],
                  }),
                ],
              })
          ),
        })
    ),
  });
}

function imageParagraph(image: PdfImage, pageWidth: number, leftMargin: number): Paragraph {
  const maxWidthPx = Math.max(24, (image.width / 72) * 96);
  const maxHeightPx = Math.max(24, (image.height / 72) * 96);
  const indent = Math.max(0, image.x - leftMargin);
  return new Paragraph({
    spacing: { before: 60, after: 60 },
    indent: indent > 1 ? { left: ptToTwip(indent) } : undefined,
    children: [
      new ImageRun({
        type: image.type,
        data: image.data,
        transformation: {
          width: Math.min(maxWidthPx, ((pageWidth - leftMargin * 2) / 72) * 96),
          height: maxHeightPx,
        },
      }),
    ],
  });
}

async function rgbaToPng(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function multiply(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

async function imageObjToPng(img: unknown): Promise<{ data: Uint8Array; type: "png" | "jpg" } | null> {
  if (!img || typeof img !== "object") return null;
  const rec = img as {
    bitmap?: ImageBitmap;
    data?: Uint8Array | Uint8ClampedArray;
    width?: number;
    height?: number;
    kind?: number;
  };

  if (typeof document === "undefined") return null;

  if (rec.bitmap) {
    const canvas = document.createElement("canvas");
    canvas.width = rec.bitmap.width;
    canvas.height = rec.bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(rec.bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), type: "png" };
  }

  if (!rec.data || !rec.width || !rec.height) return null;

  const width = rec.width;
  const height = rec.height;
  const src = rec.data;
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (rec.kind === 2 && src.length >= width * height * 3) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      rgba[i * 4] = src[j];
      rgba[i * 4 + 1] = src[j + 1];
      rgba[i * 4 + 2] = src[j + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else if (rec.kind === 3 && src.length >= width * height * 4) {
    rgba.set(src.subarray(0, rgba.length));
  } else if (rec.kind === 1) {
    for (let i = 0; i < width * height; i++) {
      const v = src[Math.floor(i / 8)] & (0x80 >> i % 8) ? 0 : 255;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
  } else {
    return null;
  }

  const data = await rgbaToPng(rgba, width, height);
  return data ? { data, type: "png" } : null;
}

async function extractImages(page: PDFPageProxy, pageHeight: number): Promise<PdfImage[]> {
  const images: PdfImage[] = [];
  if (!OPS?.save || !OPS?.paintImageXObject) return images;
  try {
    const opList = await page.getOperatorList();
    const stack: number[][] = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const seen = new Set<string>();

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i] as unknown[];
      if (fn === OPS.save) {
        stack.push(ctm.slice());
      } else if (fn === OPS.restore) {
        ctm = stack.pop() ?? ctm;
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = multiply(ctm, args.map(Number));
      } else if (
        (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintXObject) &&
        typeof args?.[0] === "string"
      ) {
        const name = args[0] as string;
        const width = Math.hypot(ctm[0], ctm[1]);
        const height = Math.hypot(ctm[2], ctm[3]);
        if (width < MIN_IMAGE_PT || height < MIN_IMAGE_PT) continue;
        const key = `${name}:${Math.round(ctm[4])}:${Math.round(ctm[5])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const obj = await Promise.race([
            new Promise<unknown>((resolve) => {
              let settled = false;
              const done = (value: unknown) => {
                if (settled) return;
                settled = true;
                resolve(value);
              };
              const existing = page.objs.get(name, done);
              if (existing) done(existing);
            }),
            new Promise<unknown>((_, reject) => {
              setTimeout(() => reject(new Error("image timeout")), 1200);
            }),
          ]);
          const png = await imageObjToPng(obj);
          if (!png) continue;
          images.push({
            x: ctm[4],
            yTop: pageHeight - ctm[5] - height,
            width,
            height,
            data: png.data,
            type: png.type,
          });
        } catch {
          // Image object not available — skip rather than failing conversion.
        }
      }
    }
  } catch {
    return [];
  }
  return images;
}

async function renderPageImage(page: PDFPageProxy, width: number, height: number): Promise<PdfImage | null> {
  if (typeof document === "undefined") return null;
  const scale = 1.6;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) return null;
  return {
    x: 0,
    yTop: 0,
    width,
    height,
    data: new Uint8Array(await blob.arrayBuffer()),
    type: "jpg",
  };
}

async function extractPageLayout(page: PDFPageProxy): Promise<PageLayout> {
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width;
  const height = viewport.height;
  const content = await page.getTextContent();
  const styles = content.styles ?? {};
  const spans: PdfSpan[] = [];
  const items = Array.isArray(content.items) ? content.items : [];

  for (const raw of items) {
    if (!isTextItem(raw) || !raw.str) continue;
    const [, , , scaleY, x, y] = raw.transform;
    const fontSize = Math.abs(scaleY) || raw.height || 11;
    const style = styles[raw.fontName];
    const fontFamilyName = style?.fontFamily || raw.fontName;
    const flags = fontFlags(raw.fontName, fontFamilyName);
    spans.push({
      text: raw.str,
      x,
      yTop: height - y - fontSize * 0.15,
      width: raw.width || fontSize * raw.str.length * 0.5,
      height: raw.height || fontSize,
      fontSize,
      fontFamily: mapFont(raw.fontName, fontFamilyName),
      bold: flags.bold,
      italic: flags.italic,
    });
  }

  const lines = groupLines(spans);
  const images = await extractImages(page, height);
  const textChars = spans.reduce((sum, s) => sum + s.text.trim().length, 0);
  return { width, height, lines, images, textChars };
}

function pageChildren(layout: PageLayout) {
  const children: Array<Paragraph | Table> = [];
  const margins = pageMargins(layout.lines, layout.width, layout.height);

  if (layout.textChars < 24 && layout.images.length === 0) {
    return { children, margins, scanned: true as const };
  }

  const tableBlocks = detectTableBlocks(layout.lines);
  const tableStart = new Map<number, number>();
  for (const block of tableBlocks) tableStart.set(block.start, block.end);

  const imageQueue = [...layout.images].sort((a, b) => a.yTop - b.yTop);
  let prevBottom: number | null = null;
  let i = 0;
  while (i < layout.lines.length) {
    while (imageQueue.length && imageQueue[0].yTop < layout.lines[i].yTop - 2) {
      const image = imageQueue.shift()!;
      children.push(imageParagraph(image, layout.width, margins.left));
    }

    const tableEnd = tableStart.get(i);
    if (tableEnd) {
      children.push(tableFromLines(layout.lines.slice(i, tableEnd), layout.width, margins.left));
      prevBottom = layout.lines[tableEnd - 1].yTop + layout.lines[tableEnd - 1].height;
      i = tableEnd;
      continue;
    }

    children.push(lineToParagraph(layout.lines[i], prevBottom, layout.width, margins));
    prevBottom = layout.lines[i].yTop + layout.lines[i].height;
    i += 1;
  }

  for (const image of imageQueue) {
    children.push(imageParagraph(image, layout.width, margins.left));
  }

  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun("")] }));
  }

  return { children, margins, scanned: false as const };
}

async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const bytes = new Uint8Array(data.slice(0));
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  return loadingTask.promise;
}

export async function convertPdfToWordBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(8, "Reading PDF…");
  const buffer = await file.arrayBuffer();
  const pdf = await loadPdf(buffer);
  const sections: Array<{
    properties: {
      page: {
        size: { width: number; height: number };
        margin: { top: number; right: number; bottom: number; left: number };
      };
    };
    children: Array<Paragraph | Table>;
  }> = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(
      10 + (pageNum / pdf.numPages) * 75,
      `Reconstructing page ${pageNum} of ${pdf.numPages}…`
    );
    const page = await pdf.getPage(pageNum);
    const layout = await extractPageLayout(page);
    const built = pageChildren(layout);

    if (built.scanned) {
      const snapshot = await renderPageImage(page, layout.width, layout.height);
      sections.push({
        properties: {
          page: {
            size: { width: ptToTwip(layout.width), height: ptToTwip(layout.height) },
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        children: snapshot
          ? [
              new Paragraph({
                spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
                children: [
                  new ImageRun({
                    type: snapshot.type,
                    data: snapshot.data,
                    transformation: {
                      width: (layout.width / 72) * 96,
                      height: (layout.height / 72) * 96,
                    },
                  }),
                ],
              }),
            ]
          : [new Paragraph({ children: [new TextRun({ text: `[Page ${pageNum}]`, italics: true })] })],
      });
      continue;
    }

    sections.push({
      properties: {
        page: {
          size: {
            width: ptToTwip(layout.width),
            height: ptToTwip(layout.height),
          },
          margin: {
            top: ptToTwip(built.margins.top),
            right: ptToTwip(built.margins.right),
            bottom: ptToTwip(built.margins.bottom),
            left: ptToTwip(built.margins.left),
          },
        },
      },
      children: built.children,
    });
  }

  onProgress?.(90, "Building Word document…");
  const doc = new Document({
    sections,
  });
  let blob: Blob;
  try {
    blob = await Packer.toBlob(doc);
  } catch {
    const buffer = await Packer.toArrayBuffer(doc);
    blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  onProgress?.(100, "Done");
  return { blob, filename: `${baseName}.docx` };
}
