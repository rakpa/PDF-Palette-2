import {
  PDFDocument,
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
import type { PDFFont, PDFHexString, PDFPage } from "pdf-lib";
import { pdfjsLib } from "../pdf-to-word/read";
import { carrierKeyFor, createCarrierFont, encodeIdentity, type CarrierFont } from "../html-to-pdf/unicode-font";

/**
 * Redaction that actually redacts.
 *
 * Drawing a black box over text hides nothing: the words are still in the
 * file, and anyone can select or extract them. The only way to be sure they
 * are gone is to stop shipping the page's content at all — so a page carrying
 * a redaction is re-made as a picture of itself with the marked areas painted
 * out before it is captured.
 *
 * That would normally cost the rest of the page's text, so the words that
 * survive are written back over the picture in rendering mode 3: invisible,
 * but still selectable and searchable. Pages with no redactions are copied
 * through untouched.
 */

/** Render resolution for a redacted page: ~192 dpi. */
const SCALE = 2;

export class RedactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedactError";
  }
}

/** A box to remove, in PDF points from the top-left of the page as displayed. */
export interface RedactionBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WordBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageWords {
  page: number;
  width: number;
  height: number;
  words: WordBox[];
}

function overlaps(word: WordBox, box: RedactionBox): boolean {
  return !(
    word.x + word.width <= box.x ||
    word.x >= box.x + box.width ||
    word.y + word.height <= box.y ||
    word.y >= box.y + box.height
  );
}

type TextItem = { str: string; transform: number[]; width: number; height: number };

/**
 * Read every page's words with their positions, measured from the top-left of
 * the page as a reader sees it — the space the redaction boxes are drawn in.
 */
export async function readWords(bytes: Uint8Array): Promise<PageWords[]> {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    void task.destroy().catch(() => undefined);
    throw new RedactError("This file could not be read as a PDF.");
  }

  try {
    const out: PageWords[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const words: WordBox[] = [];

      for (const raw of content.items as TextItem[]) {
        const run = raw.str;
        if (!run || !run.trim()) continue;
        const [, , , , x, y] = raw.transform;
        const height = raw.height || 10;
        // pdf.js reports the baseline in PDF space; the box hangs above it.
        const top = viewport.height - y - height;
        // Split the run into words. pdf.js hands back whole runs, and keeping
        // them whole would mean one redacted name takes its entire line out of
        // the text layer with it. Advance is assumed even across the run,
        // which is close enough to decide which words a box covers.
        const per = raw.width / Math.max(1, run.length);
        for (const match of run.matchAll(/\S+/g)) {
          const at = match.index ?? 0;
          words.push({
            text: match[0],
            x: x + at * per,
            y: top,
            width: match[0].length * per,
            height,
          });
        }
      }

      page.cleanup();
      out.push({ page: number, width: viewport.width, height: viewport.height, words });
    }
    return out;
  } finally {
    void task.destroy().catch(() => undefined);
  }
}

/**
 * Boxes covering every occurrence of a phrase, case-insensitively.
 *
 * Words are matched along a line rather than one at a time, so a phrase that
 * spans a space — a person's name, an address — is found the way a reader
 * would find it.
 */
export function findPhrase(pages: PageWords[], phrase: string): RedactionBox[] {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return [];
  const boxes: RedactionBox[] = [];
  const pad = 1;

  for (const page of pages) {
    const lines = new Map<number, WordBox[]>();
    for (const word of page.words) {
      // Round to the nearest point so a line's words share a key despite the
      // sub-point wobble that comes out of the text extractor.
      const key = Math.round(word.y);
      const line = lines.get(key);
      if (line) line.push(word);
      else lines.set(key, [word]);
    }

    for (const line of lines.values()) {
      line.sort((a, b) => a.x - b.x);

      // Where each word starts in the joined line, so a match maps back.
      const offsets: number[] = [];
      let joined = "";
      for (const word of line) {
        if (joined) joined += " ";
        offsets.push(joined.length);
        joined += word.text;
      }

      const haystack = joined.toLowerCase();
      let at = haystack.indexOf(needle);
      while (at >= 0) {
        const end = at + needle.length;
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;

        line.forEach((word, index) => {
          const start = offsets[index];
          const finish = start + word.text.length;
          if (finish <= at || start >= end) return;
          const per = word.width / Math.max(1, word.text.length);
          const from = Math.max(0, at - start);
          const to = Math.min(word.text.length, end - start);
          left = Math.min(left, word.x + from * per);
          right = Math.max(right, word.x + to * per);
          top = Math.min(top, word.y);
          bottom = Math.max(bottom, word.y + word.height);
        });

        if (right > left) {
          boxes.push({
            page: page.page,
            x: left - pad,
            y: top - pad,
            width: right - left + pad * 2,
            height: bottom - top + pad * 2,
          });
        }
        at = haystack.indexOf(needle, at + needle.length);
      }
    }
  }
  return boxes;
}

interface FontSet {
  fonts: Record<string, PDFFont>;
  keys: Map<PDFPage, string>;
  carrier: CarrierFont;
}

const CP1252 = /^[\u0020-\u007E\u00A0-\u00FF]*$/;

function drawInvisibleWord(page: PDFPage, set: FontSet, word: WordBox, pageHeight: number): void {
  const size = Math.max(1, word.height * 0.8);
  const text = word.text.trim();
  if (!text) return;

  let name: string;
  let encoded: PDFHexString;
  let natural: number;

  if (CP1252.test(text)) {
    const font = set.fonts.helvetica;
    let key = set.keys.get(page);
    if (!key) {
      key = page.node.newFontDictionary("H", font.ref).asString().slice(1);
      set.keys.set(page, key);
    }
    try {
      encoded = font.encodeText(text);
      natural = font.widthOfTextAtSize(text, size);
      name = key;
    } catch {
      return;
    }
  } else {
    const carried = encodeIdentity(text);
    if (!carried) return;
    encoded = carried.hex;
    natural = carried.units * size;
    name = carrierKeyFor(set.carrier, page).asString().slice(1);
  }

  const squeeze =
    natural > 0.01 && word.width > 0.01
      ? Math.min(400, Math.max(10, (word.width / natural) * 100))
      : 100;

  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(name, size),
    setCharacterSqueeze(squeeze),
    setTextMatrix(1, 0, 0, 1, word.x, pageHeight - word.y - word.height + word.height * 0.2),
    showText(encoded),
    endText(),
    popGraphicsState()
  );
}

async function renderRedactedPage(
  bytes: Uint8Array,
  pageNumber: number,
  boxes: RedactionBox[]
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new RedactError("This browser could not render the page.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    ctx.fillStyle = "#000000";
    for (const box of boxes) {
      ctx.fillRect(box.x * SCALE, box.y * SCALE, box.width * SCALE, box.height * SCALE);
    }
    page.cleanup();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new RedactError("This browser could not encode the page.");
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width: viewport.width / SCALE,
      height: viewport.height / SCALE,
    };
  } finally {
    void task.destroy().catch(() => undefined);
  }
}

export async function applyRedactions(
  bytes: Uint8Array,
  boxes: RedactionBox[],
  pages: PageWords[],
  onProgress?: (progress: number, message?: string) => void
): Promise<Uint8Array> {
  if (boxes.length === 0) throw new RedactError("Mark something to redact first.");

  const source = await PDFDocument.load(bytes).catch(() => {
    throw new RedactError("This file could not be read as a PDF.");
  });

  const affected = new Set(boxes.map((box) => box.page));
  const output = await PDFDocument.create();
  const set: FontSet = {
    fonts: { helvetica: await output.embedFont(StandardFonts.Helvetica) },
    keys: new Map(),
    carrier: createCarrierFont(output),
  };

  const total = source.getPageCount();
  for (let number = 1; number <= total; number++) {
    onProgress?.(10 + Math.round((number / total) * 80), `Page ${number} of ${total}…`);

    if (!affected.has(number)) {
      const [copied] = await output.copyPages(source, [number - 1]);
      output.addPage(copied);
      continue;
    }

    const pageBoxes = boxes.filter((box) => box.page === number);
    const picture = await renderRedactedPage(bytes, number, pageBoxes);
    const image = await output.embedPng(picture.data);
    const page = output.addPage([picture.width, picture.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: picture.width,
      height: picture.height,
    });

    const words = pages.find((entry) => entry.page === number)?.words ?? [];
    for (const word of words) {
      if (pageBoxes.some((box) => overlaps(word, box))) continue;
      drawInvisibleWord(page, set, word, picture.height);
    }
  }

  // A page that is now a picture must not carry the old text in its metadata.
  output.setTitle(source.getTitle() ?? "");
  output.setSubject("");
  output.setKeywords([]);

  onProgress?.(100, "Done");
  return output.save();
}
