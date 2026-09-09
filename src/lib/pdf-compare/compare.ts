import { pdfjsLib } from "../pdf-to-word/read";

/**
 * Comparing two PDFs.
 *
 * Two questions get asked of a pair of documents, and they want different
 * answers: what words changed, and what does the page look like now. So both
 * are computed — a word-level diff for the first, and a per-page pixel
 * comparison for the second.
 */

export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareError";
  }
}

export type ChangeKind = "same" | "added" | "removed";

export interface DiffPart {
  kind: ChangeKind;
  text: string;
}

export interface PageDiff {
  page: number;
  /** Share of pixels that differ, 0–1. Undefined when only one side has this page. */
  pixelChange?: number;
  onlyIn?: "left" | "right";
}

export interface CompareResult {
  parts: DiffPart[];
  added: number;
  removed: number;
  pages: PageDiff[];
  leftPages: number;
  rightPages: number;
}

interface PageText {
  page: number;
  words: string[];
}

async function readDocument(bytes: Uint8Array): Promise<{
  pages: PageText[];
  render: (page: number, scale: number) => Promise<ImageData>;
  release: () => void;
  count: number;
}> {
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
    throw new CompareError("One of these files could not be read as a PDF.");
  }

  const pages: PageText[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent().catch(() => ({ items: [] as unknown[] }));
    const rawItems = content?.items;
    const items = Array.isArray(rawItems)
      ? rawItems
      : rawItems && typeof (rawItems as Iterable<unknown>)[Symbol.iterator] === "function"
        ? Array.from(rawItems as Iterable<unknown>)
        : [];
    const text = items
      .map((item) =>
        item && typeof item === "object" && "str" in item ? String((item as { str: unknown }).str) : ""
      )
      .join(" ");
    page.cleanup();
    pages.push({ page: number, words: text.split(/\s+/).filter(Boolean) });
  }

  const render = async (number: number, scale: number): Promise<ImageData> => {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new CompareError("This browser could not render the pages.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  return {
    pages,
    render,
    count: pdf.numPages,
    release: () => void task.destroy().catch(() => undefined),
  };
}

/**
 * A word-level diff.
 *
 * The classic longest-common-subsequence table is quadratic, which a pair of
 * long documents cannot afford — so the identical head and tail are stripped
 * first, which on two revisions of the same document is nearly all of it, and
 * the table only covers what actually differs. A change too large for that is
 * reported as a wholesale replacement rather than left to hang the tab.
 */
const MAX_CELLS = 4_000_000;

export function diffWords(left: string[], right: string[]): DiffPart[] {
  let head = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head++;

  let tail = 0;
  while (
    tail < left.length - head &&
    tail < right.length - head &&
    left[left.length - 1 - tail] === right[right.length - 1 - tail]
  ) {
    tail++;
  }

  const a = left.slice(head, left.length - tail);
  const b = right.slice(head, right.length - tail);
  const parts: DiffPart[] = [];

  const push = (kind: ChangeKind, words: string[]) => {
    if (words.length === 0) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += ` ${words.join(" ")}`;
    else parts.push({ kind, text: words.join(" ") });
  };

  push("same", left.slice(0, head));

  if (a.length === 0 || b.length === 0) {
    push("removed", a);
    push("added", b);
  } else if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    push("removed", a);
    push("added", b);
  } else {
    // Longest common subsequence, then walk it back into runs.
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i * width + j] =
          a[i] === b[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    let run: { kind: ChangeKind; words: string[] } | null = null;
    const flush = () => {
      if (run) push(run.kind, run.words);
      run = null;
    };
    const add = (kind: ChangeKind, word: string) => {
      if (run && run.kind === kind) run.words.push(word);
      else {
        flush();
        run = { kind, words: [word] };
      }
    };

    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        add("same", a[i]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        add("removed", a[i]);
        i++;
      } else {
        add("added", b[j]);
        j++;
      }
    }
    while (i < a.length) add("removed", a[i++]);
    while (j < b.length) add("added", b[j++]);
    flush();
  }

  push("same", left.slice(left.length - tail));
  return parts;
}

/** Share of pixels that differ, comparing the two renders at a common size. */
function pixelDifference(left: ImageData, right: ImageData): number {
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  if (width === 0 || height === 0) return 1;

  let differing = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = (y * left.width + x) * 4;
      const r = (y * right.width + x) * 4;
      const delta =
        Math.abs(left.data[l] - right.data[r]) +
        Math.abs(left.data[l + 1] - right.data[r + 1]) +
        Math.abs(left.data[l + 2] - right.data[r + 2]);
      if (delta > 48) differing++;
    }
  }

  const area = width * height;
  const sizeMismatch =
    (Math.max(left.width, right.width) * Math.max(left.height, right.height) - area) /
    Math.max(1, Math.max(left.width, right.width) * Math.max(left.height, right.height));

  return Math.min(1, differing / area + sizeMismatch);
}

export async function comparePdfs(
  leftBytes: Uint8Array,
  rightBytes: Uint8Array,
  onProgress?: (progress: number, message?: string) => void
): Promise<CompareResult> {
  onProgress?.(10, "Reading both files…");
  const left = await readDocument(leftBytes);
  let right: Awaited<ReturnType<typeof readDocument>>;
  try {
    right = await readDocument(rightBytes);
  } catch (error) {
    left.release();
    throw error;
  }

  try {
    onProgress?.(35, "Comparing text…");
    const parts = diffWords(
      left.pages.flatMap((page) => page.words),
      right.pages.flatMap((page) => page.words)
    );
    const added = parts.filter((p) => p.kind === "added").reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    const removed = parts.filter((p) => p.kind === "removed").reduce((n, p) => n + p.text.split(/\s+/).length, 0);

    const total = Math.max(left.count, right.count);
    const pages: PageDiff[] = [];
    // A coarse render is plenty to tell whether a page looks different.
    const scale = 0.5;

    for (let number = 1; number <= total; number++) {
      onProgress?.(40 + Math.round((number / total) * 55), `Page ${number} of ${total}…`);
      if (number > left.count) {
        pages.push({ page: number, onlyIn: "right" });
        continue;
      }
      if (number > right.count) {
        pages.push({ page: number, onlyIn: "left" });
        continue;
      }
      const [a, b] = await Promise.all([left.render(number, scale), right.render(number, scale)]);
      pages.push({ page: number, pixelChange: pixelDifference(a, b) });
    }

    onProgress?.(100, "Done");
    return { parts, added, removed, pages, leftPages: left.count, rightPages: right.count };
  } finally {
    left.release();
    right.release();
  }
}
