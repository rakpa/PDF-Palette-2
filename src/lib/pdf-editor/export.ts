import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import {
  annotationMatrix,
  denormalizeStroke,
  editorRotationMatrix,
  hexToRgb,
  multiply,
  type Matrix,
} from "./geometry";
import { rasterizeTextBlock } from "./raster";
import type {
  Annotation,
  EditorPage,
  ImageAnnotation,
  InkAnnotation,
  ShapeAnnotation,
  TextAnnotation,
} from "./types";

export type SourceGeometry = {
  width: number;
  height: number;
  /** Display-space → user-space transform for the untouched source page. */
  displayToUser: Matrix;
};

export type ExportInput = {
  /** The untouched bytes of the uploaded file. */
  source: Uint8Array;
  pages: EditorPage[];
  annotations: Annotation[];
  /** Geometry of each *source* page, indexed as in the original file. */
  sourceGeometry: SourceGeometry[];
  fileName: string;
};

const STANDARD_FONTS: Record<string, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  // regular, bold, italic, bold-italic
  helvetica: [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
  ],
  times: [
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
  ],
  courier: [
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ],
};

class FontCache {
  private readonly cache = new Map<string, Promise<PDFFont>>();

  constructor(private readonly doc: PDFDocument) {}

  /** Script faces have no PDF standard equivalent, so they are rasterised. */
  get(fontId: string, bold: boolean, italic: boolean): Promise<PDFFont> | null {
    const family = STANDARD_FONTS[fontId];
    if (!family) return null;
    const key = `${fontId}:${bold}:${italic}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const name = family[(bold ? 1 : 0) + (italic ? 2 : 0)];
    const created = this.doc.embedFont(name);
    this.cache.set(key, created);
    return created;
  }
}

function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Break text to the box width, honouring the newlines the user typed. */
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const widthOf = (value: string) => {
    try {
      return font.widthOfTextAtSize(value, fontSize);
    } catch {
      return value.length * fontSize * 0.5;
    }
  };

  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = current + word;
      if (current && widthOf(candidate) > maxWidth) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

/** Wrap by measuring on a canvas — the raster path's equivalent of wrapText. */
function wrapTextOnCanvas(text: string, font: string, maxWidth: number): string[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.split(/\r?\n/);
  ctx.font = font;
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = current + word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

/** Run `draw` with the annotation's own space as the coordinate system. */
function inAnnotationSpace(page: PDFPage, matrix: Matrix, draw: () => void): void {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
  draw();
  page.pushOperators(popGraphicsState());
}

async function drawText(
  page: PDFPage,
  annotation: TextAnnotation,
  fonts: FontCache,
  doc: PDFDocument,
  matrix: Matrix
): Promise<void> {
  const color = hexToRgb(annotation.color);
  const lineHeight = annotation.fontSize * annotation.lineHeight;
  const fontPromise = fonts.get(annotation.fontId, annotation.bold, annotation.italic);
  const font = fontPromise ? await fontPromise : null;

  if (annotation.background) {
    const bg = hexToRgb(annotation.background);
    inAnnotationSpace(page, matrix, () => {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: annotation.width,
        height: annotation.height,
        color: rgb(bg.r, bg.g, bg.b),
      });
    });
  }

  // Script faces, and any text the standard fonts cannot encode, are drawn as
  // a picture so the output matches what the editor showed.
  if (!font || !canEncode(font, annotation.text)) {
    const stack = `${annotation.italic ? "italic " : ""}${annotation.bold ? "700 " : ""}${
      annotation.fontSize
    }px ${fontStackFor(annotation.fontId)}`;
    const lines = wrapTextOnCanvas(annotation.text, stack, annotation.width);
    const raster = await rasterizeTextBlock(lines, {
      fontId: annotation.fontId,
      fontSizePt: annotation.fontSize,
      lineHeight: annotation.lineHeight,
      color: annotation.color,
      bold: annotation.bold,
      italic: annotation.italic,
      align: annotation.align,
      widthPt: annotation.width,
    });
    if (!raster) return;
    const embedded = await doc.embedPng(raster.data);
    const height = Math.min(
      annotation.height,
      (raster.height / raster.width) * annotation.width
    );
    inAnnotationSpace(page, matrix, () => {
      page.drawImage(embedded, {
        x: 0,
        y: annotation.height - height,
        width: annotation.width,
        height,
      });
    });
    return;
  }

  const lines = wrapText(annotation.text, font, annotation.fontSize, annotation.width);
  inAnnotationSpace(page, matrix, () => {
    lines.forEach((line, i) => {
      if (!line) return;
      const width = font.widthOfTextAtSize(line, annotation.fontSize);
      const x =
        annotation.align === "center"
          ? (annotation.width - width) / 2
          : annotation.align === "right"
            ? annotation.width - width
            : 0;
      // Text is laid out downwards from the top of the box; the 0.82 puts the
      // baseline where a browser would put it for the same line height.
      const y = annotation.height - i * lineHeight - annotation.fontSize * 0.82;
      page.drawText(line, {
        x: Math.max(0, x),
        y,
        size: annotation.fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
      });
    });
  });
}

function fontStackFor(fontId: string): string {
  switch (fontId) {
    case "times":
      return "'Times New Roman', Times, serif";
    case "courier":
      return "'Courier New', Courier, monospace";
    case "signature-flow":
      return "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive";
    case "signature-formal":
      return "'Lucida Handwriting', 'Apple Chancery', cursive";
    default:
      return "Helvetica, Arial, sans-serif";
  }
}

async function drawImage(
  page: PDFPage,
  annotation: ImageAnnotation,
  doc: PDFDocument,
  matrix: Matrix
): Promise<void> {
  const embedded =
    annotation.mime === "image/jpeg"
      ? await doc.embedJpg(annotation.data)
      : await doc.embedPng(annotation.data);
  inAnnotationSpace(page, matrix, () => {
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: annotation.width,
      height: annotation.height,
      opacity: annotation.opacity,
    });
  });
}

function drawShape(page: PDFPage, annotation: ShapeAnnotation, matrix: Matrix): void {
  const stroke = hexToRgb(annotation.stroke);
  const fill = annotation.fill ? hexToRgb(annotation.fill) : null;
  const { width, height } = annotation;

  inAnnotationSpace(page, matrix, () => {
    switch (annotation.shape) {
      case "rectangle":
        page.drawRectangle({
          x: annotation.strokeWidth / 2,
          y: annotation.strokeWidth / 2,
          width: Math.max(0, width - annotation.strokeWidth),
          height: Math.max(0, height - annotation.strokeWidth),
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: annotation.strokeWidth,
          color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fill ? annotation.opacity : undefined,
          borderOpacity: annotation.opacity,
        });
        break;
      case "ellipse":
        page.drawEllipse({
          x: width / 2,
          y: height / 2,
          xScale: Math.max(0, width / 2 - annotation.strokeWidth / 2),
          yScale: Math.max(0, height / 2 - annotation.strokeWidth / 2),
          borderColor: rgb(stroke.r, stroke.g, stroke.b),
          borderWidth: annotation.strokeWidth,
          color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
          opacity: fill ? annotation.opacity : undefined,
          borderOpacity: annotation.opacity,
        });
        break;
      case "line":
      case "arrow": {
        // The line runs along whichever diagonal the user dragged; local space
        // has y pointing up, so "top" is y = height.
        const downwards = (annotation.diagonal ?? "tlbr") === "tlbr";
        const start = downwards ? { x: 0, y: height } : { x: 0, y: 0 };
        const end = downwards ? { x: width, y: 0 } : { x: width, y: height };
        page.drawLine({
          start,
          end,
          thickness: annotation.strokeWidth,
          color: rgb(stroke.r, stroke.g, stroke.b),
          opacity: annotation.opacity,
          lineCap: LineCapStyle.Round,
        });
        if (annotation.shape === "arrow") {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const head = Math.max(6, annotation.strokeWidth * 3.5);
          for (const spread of [Math.PI * 0.82, -Math.PI * 0.82]) {
            page.drawLine({
              start: end,
              end: {
                x: end.x + Math.cos(angle + spread) * head,
                y: end.y + Math.sin(angle + spread) * head,
              },
              thickness: annotation.strokeWidth,
              color: rgb(stroke.r, stroke.g, stroke.b),
              opacity: annotation.opacity,
              lineCap: LineCapStyle.Round,
            });
          }
        }
        break;
      }
      default:
        break;
    }
  });
}

function drawInk(page: PDFPage, annotation: InkAnnotation, matrix: Matrix): void {
  const stroke = hexToRgb(annotation.stroke);
  const box = { x: 0, y: 0, width: annotation.width, height: annotation.height };

  // drawSvgPath reads its path with y pointing down from the anchor, so the
  // strokes are anchored at the top-left of the box and used as captured.
  const path = annotation.strokes
    .map((points) => {
      const scaled = denormalizeStroke(points, box);
      if (scaled.length === 0) return "";
      const head = `M ${scaled[0].x.toFixed(2)} ${scaled[0].y.toFixed(2)}`;
      const tail = scaled
        .slice(1)
        .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(" ");
      return `${head} ${tail}`;
    })
    .filter(Boolean)
    .join(" ");
  if (!path) return;

  inAnnotationSpace(page, matrix, () => {
    page.drawSvgPath(path, {
      x: 0,
      y: annotation.height,
      borderColor: rgb(stroke.r, stroke.g, stroke.b),
      borderWidth: annotation.strokeWidth,
      borderOpacity: annotation.opacity,
      borderLineCap: LineCapStyle.Round,
    });
  });
}

export class PdfExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExportError";
  }
}

export async function exportEditedPdf(input: ExportInput): Promise<{ blob: Blob; filename: string }> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(input.source, { ignoreEncryption: false });
  } catch (error) {
    // A viewer can open some restricted files that cannot legitimately be
    // rewritten; say so plainly instead of surfacing a library error.
    const message = error instanceof Error ? error.message : "";
    if (/encrypt/i.test(message)) {
      throw new PdfExportError(
        "This PDF has editing restrictions. Remove its password with Unlock PDF first, then edit it."
      );
    }
    throw new PdfExportError("This PDF could not be rewritten — the file may be damaged.");
  }

  const doc = await PDFDocument.create();
  doc.setProducer("PDF Palette");
  doc.setCreator("PDF Palette");

  // Copy the pages the user kept, in the order they arranged them. Copying
  // rather than editing in place is what makes deleting and duplicating pages
  // safe, and it keeps the original page content byte-for-byte.
  const copied = await doc.copyPages(
    source,
    input.pages.map((page) => page.sourceIndex)
  );

  const fonts = new FontCache(doc);
  const byPage = new Map<string, Annotation[]>();
  for (const annotation of input.annotations) {
    const list = byPage.get(annotation.pageId);
    if (list) list.push(annotation);
    else byPage.set(annotation.pageId, [annotation]);
  }

  for (let i = 0; i < input.pages.length; i++) {
    const editorPage = input.pages[i];
    const page = copied[i];
    doc.addPage(page);

    const annotations = byPage.get(editorPage.id) ?? [];
    const geometry = input.sourceGeometry[editorPage.sourceIndex];
    // Annotations live in the page's current display space; fold the editor's
    // own rotation back out so the /Rotate written below moves them into place.
    const displayToUser = multiply(
      geometry.displayToUser,
      editorRotationMatrix(editorPage.rotation, geometry.width, geometry.height)
    );

    for (const annotation of annotations) {
      const matrix = annotationMatrix(displayToUser, annotation);
      switch (annotation.kind) {
        case "text":
          await drawText(page, annotation, fonts, doc, matrix);
          break;
        case "image":
          await drawImage(page, annotation, doc, matrix);
          break;
        case "shape":
          drawShape(page, annotation, matrix);
          break;
        case "ink":
          drawInk(page, annotation, matrix);
          break;
        case "highlight": {
          const color = hexToRgb(annotation.color);
          inAnnotationSpace(page, matrix, () => {
            page.drawRectangle({
              x: 0,
              y: 0,
              width: annotation.width,
              height: annotation.height,
              color: rgb(color.r, color.g, color.b),
              // Multiply keeps the text underneath readable.
              blendMode: BlendMode.Multiply,
            });
          });
          break;
        }
        case "whiteout": {
          const color = hexToRgb(annotation.color);
          inAnnotationSpace(page, matrix, () => {
            page.drawRectangle({
              x: 0,
              y: 0,
              width: annotation.width,
              height: annotation.height,
              color: rgb(color.r, color.g, color.b),
            });
          });
          break;
        }
        default:
          break;
      }
    }

    // The editor's own rotation is applied last, on top of the page's.
    if (editorPage.rotation) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + editorPage.rotation) % 360));
    }
  }

  const bytes = await doc.save({ useObjectStreams: true });
  const base = input.fileName.replace(/\.pdf$/i, "").trim() || "document";
  return {
    blob: new Blob([bytes], { type: "application/pdf" }),
    filename: `${base}-edited.pdf`,
  };
}
