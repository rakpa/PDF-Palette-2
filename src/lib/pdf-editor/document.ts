import "../promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Matrix } from "./geometry";
import type { EditorPage } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

export class PdfEditorError extends Error {
  constructor(
    message: string,
    readonly code: "password" | "corrupt" | "empty" | "failed"
  ) {
    super(message);
    this.name = "PdfEditorError";
  }
}

export type SourcePage = {
  index: number;
  /** Display size in points, with the page's own /Rotate applied. */
  width: number;
  height: number;
  /** Maps display points back into PDF user space. */
  displayToUser: Matrix;
};

export type LoadedPdf = {
  /** The original bytes, kept verbatim so export never re-encodes the source. */
  bytes: Uint8Array;
  proxy: PDFDocumentProxy;
  pages: SourcePage[];
  name: string;
  release: () => void;
};

function inverseOf(transform: number[]): Matrix {
  const m = transform.slice(0, 6) as Matrix;
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, 0, 0];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export async function loadPdfForEditing(file: File): Promise<LoadedPdf> {
  const buffer = await file.arrayBuffer();
  // pdf.js takes ownership of the array it is given, so the copy kept for
  // export has to be made before the document is opened.
  const bytes = new Uint8Array(buffer.slice(0));
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let proxy: PDFDocumentProxy;
  try {
    proxy = await task.promise;
  } catch (error) {
    void task.destroy().catch(() => undefined);
    const name = (error as { name?: string })?.name ?? "";
    const message = (error as Error)?.message ?? "";
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new PdfEditorError(
        "This PDF is password-protected. Unlock it first, then edit it.",
        "password"
      );
    }
    if (name === "InvalidPDFException" || /invalid|corrupt/i.test(message)) {
      throw new PdfEditorError("This file is not a readable PDF.", "corrupt");
    }
    throw new PdfEditorError(message || "The PDF could not be opened.", "failed");
  }

  if (proxy.numPages === 0) {
    void task.destroy().catch(() => undefined);
    throw new PdfEditorError("This PDF has no pages.", "empty");
  }

  const pages: SourcePage[] = [];
  for (let i = 1; i <= proxy.numPages; i++) {
    const page = await proxy.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      index: i - 1,
      width: viewport.width,
      height: viewport.height,
      displayToUser: inverseOf(viewport.transform as number[]),
    });
  }

  return {
    bytes,
    proxy,
    pages,
    name: file.name,
    release: () => void task.destroy().catch(() => undefined),
  };
}

export function initialPages(source: SourcePage[]): EditorPage[] {
  return source.map((page, i) => ({
    id: `p${i}-${Math.random().toString(36).slice(2, 8)}`,
    sourceIndex: page.index,
    rotation: 0,
    width: page.width,
    height: page.height,
  }));
}

/** Display size of a page once the editor's own rotation is applied. */
export function displaySize(page: EditorPage): { width: number; height: number } {
  return page.rotation % 180 === 0
    ? { width: page.width, height: page.height }
    : { width: page.height, height: page.width };
}

export type RenderHandle = { cancel: () => void };

/**
 * Draw a page into a canvas at the given scale. Returns a handle so a render
 * still in flight can be abandoned when the user scrolls or zooms past it.
 */
export function renderPageToCanvas(
  proxy: PDFDocumentProxy,
  page: EditorPage,
  canvas: HTMLCanvasElement,
  scale: number
): RenderHandle & { done: Promise<void> } {
  let cancelled = false;
  let task: { cancel: () => void } | null = null;

  const done = (async () => {
    const pdfPage: PDFPageProxy = await proxy.getPage(page.sourceIndex + 1);
    if (cancelled) return;
    const viewport = pdfPage.getViewport({
      scale,
      rotation: (pdfPage.rotate + page.rotation) % 360,
    });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx || cancelled) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const render = pdfPage.render({
      canvas,
      canvasContext: ctx,
      viewport,
      background: "#ffffff",
    } as Parameters<PDFPageProxy["render"]>[0]);
    task = render;
    try {
      await render.promise;
    } catch (error) {
      if (!cancelled) throw error;
    }
  })();

  return {
    done: done.catch(() => undefined) as Promise<void>,
    cancel: () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        // Already finished.
      }
    },
  };
}
