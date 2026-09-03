import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

interface Props {
  proxy: PDFDocumentProxy;
  sourceIndex: number;
  /** Extra rotation on top of the page's own, in degrees. */
  turn: number;
  /** Longest edge of the thumbnail, in CSS pixels. */
  size: number;
}

/**
 * One page, drawn small.
 *
 * Rendering is cancelled when the thumbnail leaves the screen or its rotation
 * changes, so scrolling a long document does not queue up work nobody is
 * waiting for any more.
 */
const PageThumbnail = ({ proxy, sourceIndex, turn, size }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    setReady(false);

    (async () => {
      const page = await proxy.getPage(sourceIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1, rotation: (page.rotate + turn) % 360 });
      const scale = size / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale, rotation: (page.rotate + turn) % 360 });

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx || cancelled) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const render = page.render({ canvas, canvasContext: ctx, viewport });
      task = render;
      try {
        await render.promise;
        if (!cancelled) setReady(true);
      } catch {
        // Cancelled, or a page pdf.js could not draw; the placeholder stands.
      } finally {
        page.cleanup();
      }
    })();

    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        // Already finished.
      }
    };
  }, [proxy, sourceIndex, turn, size]);

  return (
    <canvas
      ref={canvasRef}
      className={`max-h-full max-w-full rounded-sm shadow-sm transition-opacity ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    />
  );
};

export default PageThumbnail;
