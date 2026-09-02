import html2canvas from "html2canvas";
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from "pdf-lib";
import type { PDFFont, PDFHexString, PDFOperator, PDFPage } from "pdf-lib";
import { carrierKeyFor, createCarrierFont, encodeIdentity } from "./unicode-font";
import type { CarrierFont } from "./unicode-font";
import type { TextLine } from "./types";
import {
  CONTENT_HEIGHT_PX,
  CONTENT_WIDTH_PT,
  CONTENT_WIDTH_PX,
  MARGIN_PT,
  PAGE_HEIGHT_PT,
  PAGE_WIDTH_PT,
} from "./types";

/** ~192 dpi: sharp on screen and in print without doubling the file size again. */
const CAPTURE_SCALE = 2;
/** Browsers refuse canvases beyond roughly 32k in either dimension. */
const MAX_CANVAS_DIM = 16000;
/**
 * html2canvas positions its foreign-object wrapper at (scale, scale) SVG units
 * instead of the origin, which lands the capture exactly `scale` CSS pixels
 * down and to the right. Shifting the document by the same amount cancels it.
 */
const FOREIGN_OBJECT_SKEW = CAPTURE_SCALE;
/** Below this, a page slice is kept lossless without even trying JPEG. */
const PNG_BUDGET_BYTES = 120 * 1024;
/** JPEG has to beat PNG by this factor before a page gives up lossless. */
const JPEG_ADVANTAGE = 0.7;

const PT_PER_PX = 72 / 96;

/**
 * The printable half of cp1252, the encoding pdf-lib's standard fonts use.
 * The typographic characters between 0x80 and 0x9f sit outside Latin-1 and
 * have to be listed by hand.
 */
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function encodable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return CP1252_EXTRAS.has(code);
}

function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    if (encodable(char)) out += char;
    else if (/\p{White_Space}/u.test(char)) out += " ";
  }
  return out.trim();
}

interface FontSet {
  fonts: Record<string, PDFFont>;
  keys: Map<PDFPage, Map<string, PDFName>>;
  carrier: CarrierFont;
}

const FONT_NAMES: Record<string, StandardFonts> = {
  "sans": StandardFonts.Helvetica,
  "sans-b": StandardFonts.HelveticaBold,
  "sans-i": StandardFonts.HelveticaOblique,
  "sans-bi": StandardFonts.HelveticaBoldOblique,
  "serif": StandardFonts.TimesRoman,
  "serif-b": StandardFonts.TimesRomanBold,
  "serif-i": StandardFonts.TimesRomanItalic,
  "serif-bi": StandardFonts.TimesRomanBoldItalic,
  "mono": StandardFonts.Courier,
  "mono-b": StandardFonts.CourierBold,
  "mono-i": StandardFonts.CourierOblique,
  "mono-bi": StandardFonts.CourierBoldOblique,
};

function styleKey(line: TextLine): string {
  const suffix = `${line.bold ? "b" : ""}${line.italic ? "i" : ""}`;
  return suffix ? `${line.family}-${suffix}` : line.family;
}

async function embedFonts(pdf: PDFDocument): Promise<FontSet> {
  const fonts: Record<string, PDFFont> = {};
  for (const [key, name] of Object.entries(FONT_NAMES)) {
    fonts[key] = await pdf.embedFont(name);
  }
  return { fonts, keys: new Map(), carrier: createCarrierFont(pdf) };
}

function fontKeyFor(set: FontSet, page: PDFPage, key: string): PDFName {
  let perPage = set.keys.get(page);
  if (!perPage) {
    perPage = new Map();
    set.keys.set(page, perPage);
  }
  const existing = perPage.get(key);
  if (existing) return existing;
  const name = page.node.newFontDictionary("F", set.fonts[key].ref);
  perPage.set(key, name);
  return name;
}

/** One word, ready to be written: which font carries it, and how wide it is. */
interface EncodedWord {
  name: PDFName;
  encoded: PDFHexString;
  natural: number;
}

/**
 * Encode a word.
 *
 * A word the standard fonts can spell is written with one, so its per-glyph
 * widths — and therefore the shape of a selection dragged through it — match
 * the real text. Anything else goes through the Unicode carrier font, whose
 * codes are one em each.
 */
function encodeWord(page: PDFPage, set: FontSet, styles: string, text: string, size: number): EncodedWord | null {
  const latin = toWinAnsi(text);
  if (latin.length === text.trim().length) {
    const font = set.fonts[styles];
    try {
      return {
        name: fontKeyFor(set, page, styles),
        encoded: font.encodeText(latin),
        natural: font.widthOfTextAtSize(latin, size),
      };
    } catch {
      // Not spellable after all; fall through to the carrier font.
    }
  }

  const carried = encodeIdentity(text.trim());
  if (!carried) return null;
  return {
    name: carrierKeyFor(set.carrier, page),
    encoded: carried.hex,
    natural: carried.units * size,
  };
}

/**
 * Draw a line of text in rendering mode 3: it takes up no ink, but it is
 * selectable, searchable and copyable, sitting exactly over its own picture.
 *
 * Each word is placed and squeezed onto the footprint the browser measured for
 * it, so a selection dragged across the page follows the glyphs the reader can
 * see even though a substitute font is carrying the characters.
 */
function drawInvisibleLine(page: PDFPage, set: FontSet, line: TextLine, pageTop: number): void {
  const size = line.fontSize * PT_PER_PX;
  if (size <= 0) return;

  const styles = styleKey(line);
  const y = PAGE_HEIGHT_PT - MARGIN_PT - (line.baseline - pageTop) * PT_PER_PX;
  const operators: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];
  let drew = false;

  for (const word of line.words) {
    const encoded = encodeWord(page, set, styles, word.text, size);
    if (!encoded) continue;

    const target = word.width * PT_PER_PX;
    const squeeze = encoded.natural > 0.01 && target > 0.01
      ? Math.min(400, Math.max(10, (target / encoded.natural) * 100))
      : 100;

    operators.push(
      setFontAndSize(encoded.name.asString().slice(1), size),
      setCharacterSqueeze(squeeze),
      setTextMatrix(1, 0, 0, 1, MARGIN_PT + word.x * PT_PER_PX, y),
      showText(encoded.encoded)
    );
    drew = true;
  }

  if (!drew) return;
  operators.push(endText(), popGraphicsState());
  page.pushOperators(...operators);
}

/**
 * Encode a page slice.
 *
 * A page of anti-aliased text runs to hundreds of kilobytes as PNG — the grey
 * fringes around every glyph defeat lossless compression — so a slice that is
 * not already small is offered to JPEG as well, and keeps whichever is
 * clearly smaller. Pages that really are flat colour stay lossless.
 */
async function canvasBytes(canvas: HTMLCanvasElement): Promise<{ bytes: Uint8Array; type: "png" | "jpg" }> {
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (png && png.size <= PNG_BUDGET_BYTES) {
    return { bytes: new Uint8Array(await png.arrayBuffer()), type: "png" };
  }
  const jpg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (jpg && (!png || jpg.size < png.size * JPEG_ADVANTAGE)) {
    return { bytes: new Uint8Array(await jpg.arrayBuffer()), type: "jpg" };
  }
  if (!png) throw new Error("The page could not be rasterised in this browser.");
  return { bytes: new Uint8Array(await png.arrayBuffer()), type: "png" };
}

function sliceCanvas(source: HTMLCanvasElement, top: number, height: number): HTMLCanvasElement {
  const slice = document.createElement("canvas");
  slice.width = source.width;
  slice.height = Math.max(1, Math.round(height));
  const ctx = slice.getContext("2d");
  if (!ctx) throw new Error("The page could not be rasterised in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(source, 0, Math.round(top), source.width, slice.height, 0, 0, slice.width, slice.height);
  return slice;
}

/** Group consecutive pages into capture chunks a canvas can actually hold. */
function chunkPages(breaks: number[], contentHeight: number): Array<{ from: number; to: number }> {
  const limit = MAX_CANVAS_DIM / CAPTURE_SCALE;
  const chunks: Array<{ from: number; to: number }> = [];
  let from = 0;
  for (let page = 0; page < breaks.length; page++) {
    const end = page + 1 < breaks.length ? breaks[page + 1] : contentHeight;
    if (end - breaks[from] > limit && page > from) {
      chunks.push({ from, to: page });
      from = page;
    }
  }
  chunks.push({ from, to: breaks.length });
  return chunks;
}

/**
 * Capture one band of the document.
 *
 * The band is chosen by offsetting the painted document rather than by asking
 * html2canvas to crop, because its faithful renderer — which hands the layout
 * to the browser's own SVG engine rather than repainting it from parsed styles
 * — ignores the crop and would return a blank canvas. Offsetting works for
 * both renderers, so the fallback path takes the same route.
 */
async function captureBand(
  doc: Document,
  top: number,
  height: number,
  contentHeight: number
): Promise<HTMLCanvasElement> {
  const body = doc.body;
  const previous = { position: body.style.position, top: body.style.top, left: body.style.left };

  const options = {
    backgroundColor: "#ffffff",
    scale: CAPTURE_SCALE,
    useCORS: true,
    allowTaint: false,
    logging: false,
    x: 0,
    y: 0,
    width: CONTENT_WIDTH_PX,
    height,
    windowWidth: CONTENT_WIDTH_PX,
    windowHeight: Math.ceil(contentHeight),
    scrollX: 0,
    scrollY: 0,
  } as const;

  try {
    body.style.position = "relative";
    body.style.top = `${-(top + FOREIGN_OBJECT_SKEW)}px`;
    body.style.left = `${-FOREIGN_OBJECT_SKEW}px`;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      return await html2canvas(doc.documentElement, { ...options, foreignObjectRendering: true });
    } catch {
      // The SVG route can fail outright on a document the browser will not
      // serialise. html2canvas's own painter always produces something, at the
      // cost of placing text by its own font metrics rather than the layout's.
      body.style.top = `${-top}px`;
      body.style.left = "";
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return await html2canvas(doc.documentElement, { ...options, foreignObjectRendering: false });
    }
  } finally {
    body.style.position = previous.position;
    body.style.top = previous.top;
    body.style.left = previous.left;
  }
}

export interface RenderInput {
  doc: Document;
  lines: TextLine[];
  breaks: number[];
  contentHeight: number;
  onProgress?: (progress: number, message?: string) => void;
}

export async function renderPages({
  doc,
  lines,
  breaks,
  contentHeight,
  onProgress,
}: RenderInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const set = await embedFonts(pdf);
  const pages: PDFPage[] = breaks.map(() => pdf.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]));

  const chunks = chunkPages(breaks, contentHeight);
  let done = 0;

  for (const chunk of chunks) {
    const top = breaks[chunk.from];
    const bottom = chunk.to < breaks.length ? breaks[chunk.to] : contentHeight;
    const height = Math.max(1, bottom - top);

    const canvas = await captureBand(doc, top, height, contentHeight);

    for (let page = chunk.from; page < chunk.to; page++) {
      const pageTop = breaks[page];
      const pageBottom = page + 1 < breaks.length ? breaks[page + 1] : contentHeight;
      const sliceHeightPx = Math.max(1, Math.min(pageBottom - pageTop, CONTENT_HEIGHT_PX));

      const slice = sliceCanvas(
        canvas,
        (pageTop - top) * CAPTURE_SCALE,
        sliceHeightPx * CAPTURE_SCALE
      );
      const { bytes, type } = await canvasBytes(slice);
      const image = type === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

      const drawHeight = sliceHeightPx * PT_PER_PX;
      pages[page].drawImage(image, {
        x: MARGIN_PT,
        y: PAGE_HEIGHT_PT - MARGIN_PT - drawHeight,
        width: CONTENT_WIDTH_PT,
        height: drawHeight,
      });

      done++;
      onProgress?.(55 + Math.round((done / pages.length) * 35), `Page ${done} of ${pages.length}…`);
    }
  }

  for (const line of lines) {
    let page = 0;
    while (page + 1 < breaks.length && line.baseline >= breaks[page + 1]) page++;
    if (line.baseline < breaks[page] - 1) continue;
    if (line.baseline - breaks[page] > CONTENT_HEIGHT_PX + 2) continue;
    drawInvisibleLine(pages[page], set, line, breaks[page]);
  }

  return pdf.save();
}
