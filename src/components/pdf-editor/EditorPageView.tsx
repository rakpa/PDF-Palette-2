import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cn } from "@/lib/utils";
import { displaySize, renderPageToCanvas } from "@/lib/pdf-editor/document";
import { boxOfPoints, normalizeStroke } from "@/lib/pdf-editor/geometry";
import { strokePath } from "@/lib/pdf-editor/raster";
import type {
  Annotation,
  Box,
  EditorPage,
  EditorTool,
  Point,
} from "@/lib/pdf-editor/types";
import AnnotationItem, { type HandleId } from "./AnnotationItem";

type DragState =
  | { type: "move"; id: string; origin: Point; box: Box }
  | { type: "resize"; id: string; handle: HandleId; origin: Point; box: Box }
  | { type: "create"; origin: Point; current: Point }
  | { type: "draw"; points: Point[] };

type Props = {
  proxy: PDFDocumentProxy;
  page: EditorPage;
  pageNumber: number;
  scale: number;
  tool: EditorTool;
  annotations: Annotation[];
  selectedId: string | null;
  editingId: string | null;
  strokeColor: string;
  strokeWidth: number;
  onSelect: (id: string | null) => void;
  onCreateBox: (page: EditorPage, box: Box, diagonal: "tlbr" | "bltr") => void;
  onCreateAt: (page: EditorPage, point: Point) => void;
  onCreateInk: (page: EditorPage, box: Box, strokes: Point[][]) => void;
  onUpdate: (id: string, patch: Partial<Annotation>, transient?: boolean) => void;
  onStartEdit: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onCommitText: () => void;
};

const DRAG_TOOLS: EditorTool[] = [
  "rectangle",
  "ellipse",
  "line",
  "arrow",
  "highlight",
  "whiteout",
];

const CLICK_TOOLS: EditorTool[] = ["text", "image", "signature", "initials", "date"];

const EditorPageView = ({
  proxy,
  page,
  pageNumber,
  scale,
  tool,
  annotations,
  selectedId,
  editingId,
  strokeColor,
  strokeWidth,
  onSelect,
  onCreateBox,
  onCreateAt,
  onCreateInk,
  onUpdate,
  onStartEdit,
  onChangeText,
  onCommitText,
}: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const size = displaySize(page);

  // Pages are only rasterised once they come near the viewport, so a long
  // document does not try to paint every page at once.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setVisible(entry.isIntersecting)),
      { root: null, rootMargin: "800px 0px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const handle = renderPageToCanvas(proxy, page, canvas, scale * dpr);
    let cancelled = false;
    handle.done.then(() => {
      if (!cancelled) setRendered(true);
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [proxy, page, scale, visible]);

  const pointFrom = useCallback(
    (event: { clientX: number; clientY: number }): Point => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: Math.max(0, Math.min(size.width, (event.clientX - rect.left) / scale)),
        y: Math.max(0, Math.min(size.height, (event.clientY - rect.top) / scale)),
      };
    },
    [scale, size.height, size.width]
  );

  // Live preview of the stroke being drawn.
  useEffect(() => {
    const canvas = inkRef.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * scale * dpr);
    canvas.height = Math.round(size.height * scale * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (drag?.type !== "draw") return;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(strokePath(drag.points));
  }, [drag, scale, size.height, size.width, strokeColor, strokeWidth]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (editingId) {
      onCommitText();
      return;
    }
    const point = pointFrom(event);

    if (tool === "select") {
      onSelect(null);
      return;
    }
    if (CLICK_TOOLS.includes(tool)) {
      // Handled on click instead, so the browser has finished moving focus
      // before a new text box tries to take it.
      return;
    }
    if (tool === "draw") {
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setDrag({ type: "draw", points: [point] });
      return;
    }
    if (DRAG_TOOLS.includes(tool)) {
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setDrag({ type: "create", origin: point, current: point });
    }
  };

  const startMove = (id: string, event: React.PointerEvent) => {
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDrag({ type: "move", id, origin: pointFrom(event), box: { ...annotation } });
  };

  const startResize = (id: string, handle: HandleId, event: React.PointerEvent) => {
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDrag({ type: "resize", id, handle, origin: pointFrom(event), box: { ...annotation } });
  };

  useEffect(() => {
    if (!drag) return;

    const clampToPage = (box: Box): Box => ({
      width: Math.max(6, Math.min(box.width, size.width)),
      height: Math.max(6, Math.min(box.height, size.height)),
      x: Math.max(0, Math.min(box.x, size.width - Math.max(6, box.width))),
      y: Math.max(0, Math.min(box.y, size.height - Math.max(6, box.height))),
    });

    const onMove = (event: PointerEvent) => {
      const point = pointFrom(event);
      if (drag.type === "move") {
        onUpdate(
          drag.id,
          clampToPage({
            ...drag.box,
            x: drag.box.x + (point.x - drag.origin.x),
            y: drag.box.y + (point.y - drag.origin.y),
          }),
          true
        );
      } else if (drag.type === "resize") {
        const dx = point.x - drag.origin.x;
        const dy = point.y - drag.origin.y;
        const box = { ...drag.box };
        if (drag.handle.includes("e")) box.width = drag.box.width + dx;
        if (drag.handle.includes("s")) box.height = drag.box.height + dy;
        if (drag.handle.includes("w")) {
          box.x = drag.box.x + dx;
          box.width = drag.box.width - dx;
        }
        if (drag.handle.includes("n")) {
          box.y = drag.box.y + dy;
          box.height = drag.box.height - dy;
        }
        // A grip dragged past the opposite edge flips the box rather than
        // collapsing it to nothing.
        if (box.width < 0) {
          box.x += box.width;
          box.width = Math.abs(box.width);
        }
        if (box.height < 0) {
          box.y += box.height;
          box.height = Math.abs(box.height);
        }
        onUpdate(drag.id, clampToPage(box), true);
      } else if (drag.type === "create") {
        setDrag({ ...drag, current: point });
      } else if (drag.type === "draw") {
        setDrag({ type: "draw", points: [...drag.points, point] });
      }
    };

    const onUp = () => {
      if (drag.type === "create") {
        const box = {
          x: Math.min(drag.origin.x, drag.current.x),
          y: Math.min(drag.origin.y, drag.current.y),
          width: Math.abs(drag.current.x - drag.origin.x),
          height: Math.abs(drag.current.y - drag.origin.y),
        };
        if (box.width > 3 && box.height > 3) {
          const goingDown = drag.current.y >= drag.origin.y;
          const goingRight = drag.current.x >= drag.origin.x;
          onCreateBox(page, box, goingDown === goingRight ? "tlbr" : "bltr");
        }
      } else if (drag.type === "draw") {
        const box = boxOfPoints(drag.points, strokeWidth);
        if (drag.points.length > 1 && box.width > 1 && box.height > 1) {
          onCreateInk(page, box, [normalizeStroke(drag.points, box)]);
        }
      } else if (drag.type === "move" || drag.type === "resize") {
        // Re-apply the final position as a single history entry.
        const annotation = annotations.find((a) => a.id === drag.id);
        if (annotation) {
          onUpdate(drag.id, {
            x: annotation.x,
            y: annotation.y,
            width: annotation.width,
            height: annotation.height,
          });
        }
      }
      setDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    annotations,
    drag,
    onCreateBox,
    onCreateInk,
    onUpdate,
    page,
    pointFrom,
    size.height,
    size.width,
    strokeWidth,
  ]);

  const preview =
    drag?.type === "create"
      ? {
          left: Math.min(drag.origin.x, drag.current.x) * scale,
          top: Math.min(drag.origin.y, drag.current.y) * scale,
          width: Math.abs(drag.current.x - drag.origin.x) * scale,
          height: Math.abs(drag.current.y - drag.origin.y) * scale,
        }
      : null;

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-1.5" data-page-id={page.id}>
      <div
        className="relative bg-white shadow-md ring-1 ring-border"
        style={{ width: size.width * scale, height: size.height * scale }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          style={{ opacity: rendered ? 1 : 0 }}
        />
        {!rendered && (
          <div className="absolute inset-0 animate-pulse bg-muted/40" aria-hidden />
        )}

        <div
          ref={overlayRef}
          role="presentation"
          className={cn(
            "absolute inset-0",
            tool === "select" ? "cursor-default" : "cursor-crosshair"
          )}
          onPointerDown={handlePointerDown}
          onClick={(event) => {
            if (!CLICK_TOOLS.includes(tool) || editingId) return;
            onCreateAt(page, pointFrom(event));
          }}
        >
          {annotations.map((annotation) => (
            <AnnotationItem
              key={annotation.id}
              annotation={annotation}
              scale={scale}
              selected={annotation.id === selectedId}
              editing={annotation.id === editingId}
              interactive={tool === "select" || annotation.id === selectedId}
              onSelect={() => onSelect(annotation.id)}
              onStartDrag={(event) => startMove(annotation.id, event)}
              onStartResize={(event, handle) => startResize(annotation.id, handle, event)}
              onStartEdit={() => onStartEdit(annotation.id)}
              onChangeText={(text) => onChangeText(annotation.id, text)}
              onCommitText={onCommitText}
              onGrow={(height) =>
                onUpdate(
                  annotation.id,
                  { height: Math.min(height, size.height - annotation.y) },
                  true
                )
              }
            />
          ))}

          <canvas
            ref={inkRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ display: tool === "draw" ? "block" : "none" }}
          />

          {preview && (
            <div
              className="pointer-events-none absolute border-2 border-dashed border-primary/70 bg-primary/10"
              style={preview}
            />
          )}
        </div>
      </div>
      <span className="text-xs text-muted-foreground">Page {pageNumber}</span>
    </div>
  );
};

export default EditorPageView;
