import "../promise-with-resolvers-polyfill";
import { createWorker } from "tesseract.js";

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;
import {
  PDFDocument,
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
import type { PDFOperator, PDFPage } from "pdf-lib";
import { pdfjsLib } from "../pdf-to-word/read";
import { carrierKeyFor, createCarrierFont, encodeIdentity } from "../html-to-pdf/unicode-font";
import type { CarrierFont } from "../html-to-pdf/unicode-font";

/**
 * OCR PDF.
 *
 * A scanned page is a picture of text, not text: readers cannot search it or
 * copy it. Each such page is rendered, recognised in the tab, and given an
 * invisible text layer that sits on the original artwork — the file still
 * looks the same, but the words are selectable. Pages that already have a
 * real text layer are copied through unchanged.
 */

const OCR_DPI = 150;
const MAX_CANVAS_DIM = 2600;
/** Below this, a word is more likely noise than a glyph. */
const MIN_CONFIDENCE = 40;
/**
 * Same bar the Word converter uses: enough native characters and the page is
 * already searchable, so recognising it again would only duplicate the layer.
 */
const NATIVE_TEXT_CHARS = 24;

export class OcrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrError";
  }
}

export type OcrProgress = (progress: number, message?: string) => void;

export interface OcrResult {
  blob: Blob;
  filename: string;
  ocrPages: number;
  skippedPages: number;
  words: number;
}

type PageViewport = {
  convertToPdfPoint: (x: number, y: number) => number[];
};

interface OcrWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const TESSERACT_BASE = `${
  import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
}tesseract/`;

let workerPromise: Promise<TesseractWorker> | null = null;

async function createOcrWorker(): Promise<TesseractWorker> {
  try {
    const worker = await createWorker("eng", 1, {
      workerPath: `${TESSERACT_BASE}worker.min.js`,
      corePath: `${TESSERACT_BASE}core/`,
      langPath: `${TESSERACT_BASE}lang/`,
      workerBlobURL: false,
      gzip: true,
    });
    await worker.setParameters({
      user_defined_dpi: String(OCR_DPI),
    });
    return worker;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    throw new OcrError(
      detail
        ? `The OCR engine could not be loaded (${detail}).`
        : "The OCR engine could not be loaded in this browser."
    );
  }
}

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** Preload the recogniser while the user picks a file. */
export function warmupOcr(): Promise<void> {
  return getWorker().then(() => undefined);
}

function nativeCharCount(items: Array<{ str?: string }>): number {
  let n = 0;
  for (const item of items) {
    const text = item.str ?? "";
    for (const char of text) {
      if (!/\s/u.test(char)) n += 1;
    }
  }
  return n;
}

function pdfBox(
  viewport: PageViewport,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { x: number; y: number; width: number; height: number } {
  const corners = [
    viewport.convertToPdfPoint(x0, y0),
    viewport.convertToPdfPoint(x1, y0),
    viewport.convertToPdfPoint(x0, y1),
    viewport.convertToPdfPoint(x1, y1),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function wordsFromPage(
  data: { blocks: Array<{ paragraphs: Array<{ lines: Array<{
    baseline?: { x0: number; y0: number };
    words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  }> }> }> | null },
  viewport: PageViewport
): OcrWord[] {
  const out: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? "").trim();
          if (!text || word.confidence < MIN_CONFIDENCE) continue;
          const box = pdfBox(
            viewport,
            word.bbox.x0,
            word.bbox.y0,
            word.bbox.x1,
            word.bbox.y1
          );
          if (box.width < 0.5 || box.height < 0.5) continue;

          let y = box.y;
          if (line.baseline) {
            const [, baselineY] = viewport.convertToPdfPoint(word.bbox.x0, line.baseline.y0);
            if (Number.isFinite(baselineY)) y = baselineY;
          }

          out.push({ text, x: box.x, y, width: box.width, height: box.height });
        }
      }
    }
  }
  return out;
}

function drawInvisibleWords(page: PDFPage, font: CarrierFont, words: OcrWord[]): void {
  if (words.length === 0) return;
  const name = carrierKeyFor(font, page);
  const fontTag = name.asString().slice(1);
  const operators: PDFOperator[] = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(fontTag, 12),
  ];
  let drew = false;

  for (const word of words) {
    const encoded = encodeIdentity(word.text);
    if (!encoded) continue;
    const size = Math.max(2, word.height * 0.85);
    const natural = encoded.units * size;
    const squeeze =
      natural > 0.01 && word.width > 0.01
        ? Math.min(400, Math.max(10, (word.width / natural) * 100))
        : 100;
    operators.push(
      setFontAndSize(fontTag, size),
      setCharacterSqueeze(squeeze),
      setTextMatrix(1, 0, 0, 1, word.x, word.y),
      showText(encoded.hex)
    );
    drew = true;
  }

  if (!drew) return;
  operators.push(endText(), popGraphicsState());
  page.pushOperators(...operators);
}

async function renderForOcr(
  page: import("pdfjs-dist").PDFPageProxy
): Promise<{ canvas: HTMLCanvasElement; viewport: PageViewport }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    OCR_DPI / 72,
    MAX_CANVAS_DIM / Math.max(base.width, base.height, 1)
  );
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new OcrError("This browser could not render the page.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { canvas, viewport };
}

/**
 * Open a PDF, recognise every scanned page, and write an invisible text layer
 * over the original pages. Nothing is uploaded.
 */
export async function ocrPdf(
  file: File,
  onProgress?: OcrProgress
): Promise<OcrResult> {
  onProgress?.(4, "Reading PDF…");
  const buffer = await file.arrayBuffer();
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    void task.destroy().catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    const name = (error as { name?: string })?.name ?? "";
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new OcrError("This PDF is password-protected. Unlock it first, then try again.");
    }
    throw new OcrError("This file could not be read as a PDF.");
  }

  if (pdf.numPages === 0) {
    await task.destroy().catch(() => undefined);
    throw new OcrError("This PDF has no pages.");
  }

  try {
    onProgress?.(8, "Loading OCR engine…");
    const worker = await getWorker();

    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(buffer.slice(0));
    } catch {
      throw new OcrError("This PDF could not be opened for writing.");
    }
    const pages = doc.getPages();
    if (pages.length !== pdf.numPages) {
      throw new OcrError("This PDF could not be opened for writing.");
    }
    const font = createCarrierFont(doc);

    let ocrPages = 0;
    let skippedPages = 0;
    let words = 0;

    for (let number = 1; number <= pdf.numPages; number++) {
      const pageShare = 84 / pdf.numPages;
      const pageStart = 10 + (number - 1) * pageShare;
      onProgress?.(pageStart, `Reading page ${number} of ${pdf.numPages}…`);

      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        const native = nativeCharCount(content.items as Array<{ str?: string }>);
        if (native >= NATIVE_TEXT_CHARS) {
          skippedPages += 1;
          continue;
        }

        onProgress?.(pageStart + pageShare * 0.15, `Recognising page ${number} of ${pdf.numPages}…`);
        const { canvas, viewport } = await renderForOcr(page);
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        canvas.width = 0;
        canvas.height = 0;

        const found = wordsFromPage(data, viewport);
        drawInvisibleWords(pages[number - 1], font, found);
        ocrPages += 1;
        words += found.length;
      } finally {
        page.cleanup();
      }

      onProgress?.(pageStart + pageShare, `Page ${number} of ${pdf.numPages}…`);
    }

    onProgress?.(96, "Writing PDF…");
    const bytes = await doc.save();
    const baseName = file.name.replace(/\.pdf$/i, "") || "document";
    onProgress?.(100, "Done");

    return {
      blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
      filename: `${baseName}-ocr.pdf`,
      ocrPages,
      skippedPages,
      words,
    };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
