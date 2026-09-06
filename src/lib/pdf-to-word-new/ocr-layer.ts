import type { PDFPageProxy } from "pdfjs-dist";
import type { HiddenTextLine } from "./emit";

/**
 * Recognising a page that has no text layer.
 *
 * A scanned page is reproduced as its own picture — that is the only way to
 * keep it looking like itself. The words are still recovered, and written over
 * the picture as hidden runs at the position they were read from, so the page
 * can be searched and its text copied without anything covering the scan.
 *
 * Tesseract is loaded on demand: a PDF that carries real text never pays for
 * the engine.
 */

const OCR_DPI = 150;
const MAX_CANVAS_DIM = 2600;
/** Below this a word is more likely noise than a glyph. */
const MIN_CONFIDENCE = 40;

type Worker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;

const TESSERACT_BASE = `${
  import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
}tesseract/`;

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        workerPath: `${TESSERACT_BASE}worker.min.js`,
        corePath: `${TESSERACT_BASE}core/`,
        langPath: `${TESSERACT_BASE}lang/`,
        workerBlobURL: false,
        gzip: true,
      });
      // The engine defaults to reading the image as a single block of text,
      // which drops a display heading and a ruled table on a page that has
      // both. A full page needs full segmentation.
      await worker.setParameters({
        user_defined_dpi: String(OCR_DPI),
        tessedit_pageseg_mode: PSM.AUTO,
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

type OcrLine = {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words?: Array<{ text: string; confidence: number }>;
};

/**
 * Read one page and return its lines in page points, measured from the
 * top-left of the rotated page — the same frame the rest of the converter
 * works in, so the viewport scale is the only conversion needed.
 */
export async function recogniseScannedPage(page: PDFPageProxy): Promise<HiddenTextLine[]> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(OCR_DPI / 72, MAX_CANVAS_DIM / Math.max(base.width, base.height, 1));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  let lines: OcrLine[] = [];
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        lines = lines.concat((paragraph.lines ?? []) as OcrLine[]);
      }
    }
  } catch (error) {
    // A page that cannot be recognised still reaches Word as its picture.
    console.warn("pdf-to-word: OCR unavailable for this page", error);
    return [];
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }

  const out: HiddenTextLine[] = [];
  for (const line of lines) {
    const text = (line.words ?? [])
      .filter((word) => word.confidence >= MIN_CONFIDENCE)
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const x = line.bbox.x0 / scale;
    const y = line.bbox.y0 / scale;
    const width = (line.bbox.x1 - line.bbox.x0) / scale;
    const height = (line.bbox.y1 - line.bbox.y0) / scale;
    if (width < 1 || height < 1) continue;
    out.push({ text, x, y, width, height });
  }
  return out;
}
