import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fontStack } from "@/lib/pdf-editor/raster";
import { denormalizeStroke } from "@/lib/pdf-editor/geometry";
import { strokePath } from "@/lib/pdf-editor/raster";
import type { Annotation, Box } from "@/lib/pdf-editor/types";

/** Corner and edge grips, as fractions of the box. */
const HANDLES = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
] as const;

export type HandleId = (typeof HANDLES)[number]["id"];

type Props = {
  annotation: Annotation;
  onGrow?: (height: number) => void;
  scale: number;
  selected: boolean;
  editing: boolean;
  interactive: boolean;
  onSelect: () => void;
  onStartDrag: (event: React.PointerEvent) => void;
  onStartResize: (event: React.PointerEvent, handle: HandleId) => void;
  onStartEdit: () => void;
  onChangeText: (text: string) => void;
  onCommitText: () => void;
};

function InkCanvas({ annotation, scale }: { annotation: Extract<Annotation, { kind: "ink" }>; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, annotation.width * scale);
    const height = Math.max(1, annotation.height * scale);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = annotation.stroke;
    ctx.lineWidth = annotation.strokeWidth * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = annotation.opacity;
    const box: Box = { x: 0, y: 0, width, height };
    for (const stroke of annotation.strokes) {
      ctx.stroke(strokePath(denormalizeStroke(stroke, box)));
    }
  }, [annotation, scale]);

  return <canvas ref={ref} className="pointer-events-none h-full w-full" />;
}

function ImageView({ annotation }: { annotation: Extract<Annotation, { kind: "image" }> }) {
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    const blob = new Blob([annotation.data], { type: annotation.mime });
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [annotation.data, annotation.mime]);

  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      className="pointer-events-none h-full w-full select-none"
      style={{ opacity: annotation.opacity, objectFit: "fill" }}
    />
  ) : null;
}

function ShapeView({
  annotation,
  scale,
}: {
  annotation: Extract<Annotation, { kind: "shape" }>;
  scale: number;
}) {
  const w = Math.max(1, annotation.width * scale);
  const h = Math.max(1, annotation.height * scale);
  const stroke = annotation.strokeWidth * scale;
  const half = stroke / 2;

  return (
    <svg width={w} height={h} className="pointer-events-none overflow-visible">
      {annotation.shape === "rectangle" && (
        <rect
          x={half}
          y={half}
          width={Math.max(0, w - stroke)}
          height={Math.max(0, h - stroke)}
          fill={annotation.fill ?? "none"}
          stroke={annotation.stroke}
          strokeWidth={stroke}
          opacity={annotation.opacity}
        />
      )}
      {annotation.shape === "ellipse" && (
        <ellipse
          cx={w / 2}
          cy={h / 2}
          rx={Math.max(0, w / 2 - half)}
          ry={Math.max(0, h / 2 - half)}
          fill={annotation.fill ?? "none"}
          stroke={annotation.stroke}
          strokeWidth={stroke}
          opacity={annotation.opacity}
        />
      )}
      {(annotation.shape === "line" || annotation.shape === "arrow") &&
        (() => {
          // SVG y points down, so the "top-left to bottom-right" diagonal runs
          // from (0, 0) to (w, h).
          const downwards = (annotation.diagonal ?? "tlbr") === "tlbr";
          const x1 = 0;
          const y1 = downwards ? 0 : h;
          const x2 = w;
          const y2 = downwards ? h : 0;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const head = Math.max(6 * scale, stroke * 3.5);
          return (
            <>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={annotation.stroke}
                strokeWidth={stroke}
                strokeLinecap="round"
                opacity={annotation.opacity}
              />
              {annotation.shape === "arrow" &&
                [Math.PI * 0.82, -Math.PI * 0.82].map((spread, i) => (
                  <line
                    key={i}
                    x1={x2}
                    y1={y2}
                    x2={x2 + Math.cos(angle + spread) * head}
                    y2={y2 + Math.sin(angle + spread) * head}
                    stroke={annotation.stroke}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    opacity={annotation.opacity}
                  />
                ))}
            </>
          );
        })()}
    </svg>
  );
}

function TextView({
  annotation,
  scale,
  editing,
  onChangeText,
  onCommitText,
  onGrow,
}: {
  annotation: Extract<Annotation, { kind: "text" }>;
  scale: number;
  editing: boolean;
  onChangeText: (text: string) => void;
  onCommitText: () => void;
  onGrow?: (height: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const focusedAt = useRef(0);

  useEffect(() => {
    if (!editing) return;
    // Focus on the next frame: the click that created this box is still
    // settling, and the browser would otherwise move focus back to the body.
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
      focusedAt.current = Date.now();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  // Grow the box downwards as the text wraps, so nothing is typed out of sight.
  useEffect(() => {
    const element = ref.current;
    if (!editing || !element || !onGrow) return;
    const needed = element.scrollHeight / scale;
    if (needed > annotation.height + 1) onGrow(needed);
  }, [annotation.height, annotation.text, editing, onGrow, scale]);

  const style: React.CSSProperties = {
    fontFamily: fontStack(annotation.fontId),
    fontSize: annotation.fontSize * scale,
    lineHeight: annotation.lineHeight,
    color: annotation.color,
    fontWeight: annotation.bold ? 700 : 400,
    fontStyle: annotation.italic ? "italic" : "normal",
    textAlign: annotation.align,
    background: annotation.background ?? "transparent",
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={annotation.text}
        onChange={(e) => onChangeText(e.target.value)}
        onBlur={() => {
          // Ignore the blur that can arrive before the caret has settled.
          if (Date.now() - focusedAt.current < 250) {
            requestAnimationFrame(() => ref.current?.focus());
            return;
          }
          onCommitText();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCommitText();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        spellCheck={false}
        className="h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
        style={style}
      />
    );
  }

  return (
    <div
      className="pointer-events-none h-full w-full whitespace-pre-wrap break-words"
      style={style}
    >
      {annotation.text || " "}
    </div>
  );
}

const AnnotationItem = ({
  annotation,
  onGrow,
  scale,
  selected,
  editing,
  interactive,
  onSelect,
  onStartDrag,
  onStartResize,
  onStartEdit,
  onChangeText,
  onCommitText,
}: Props) => {
  const isText = annotation.kind === "text";

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${annotation.kind} element`}
      className={cn(
        "absolute",
        interactive ? "cursor-move" : "pointer-events-none",
        selected && "outline outline-2 outline-offset-1 outline-primary"
      )}
      style={{
        left: annotation.x * scale,
        top: annotation.y * scale,
        width: annotation.width * scale,
        height: annotation.height * scale,
        // Highlights sit under nothing but darken what is beneath them.
        mixBlendMode: annotation.kind === "highlight" ? "multiply" : undefined,
      }}
      onPointerDown={(event) => {
        if (!interactive || editing) return;
        event.stopPropagation();
        onSelect();
        onStartDrag(event);
      }}
      onDoubleClick={(event) => {
        if (!interactive || !isText) return;
        event.stopPropagation();
        onStartEdit();
      }}
    >
      {annotation.kind === "text" && (
        <TextView
          annotation={annotation}
          scale={scale}
          editing={editing}
          onChangeText={onChangeText}
          onCommitText={onCommitText}
          onGrow={onGrow}
        />
      )}
      {annotation.kind === "image" && <ImageView annotation={annotation} />}
      {annotation.kind === "shape" && <ShapeView annotation={annotation} scale={scale} />}
      {annotation.kind === "ink" && <InkCanvas annotation={annotation} scale={scale} />}
      {annotation.kind === "highlight" && (
        <div className="h-full w-full" style={{ background: annotation.color }} />
      )}
      {annotation.kind === "whiteout" && (
        <div className="h-full w-full" style={{ background: annotation.color }} />
      )}

      {selected && interactive && !editing && (
        <>
          {HANDLES.map((handle) => (
            <span
              key={handle.id}
              role="presentation"
              onPointerDown={(event) => {
                event.stopPropagation();
                onStartResize(event, handle.id);
              }}
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-primary bg-background shadow-sm"
              style={{
                left: `${handle.x * 100}%`,
                top: `${handle.y * 100}%`,
                cursor: handle.cursor,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
};

export default AnnotationItem;
export { HANDLES };
