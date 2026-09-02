import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  imageFileToPng,
  rasterizeStrokes,
  rasterizeText,
  removeBackground,
  fontStack,
} from "@/lib/pdf-editor/raster";
import { strokePath } from "@/lib/pdf-editor/raster";
import { newId } from "@/lib/pdf-editor/state";
import type { Point, SavedSignature } from "@/lib/pdf-editor/types";

const INK_COLORS = ["#111827", "#1d4ed8", "#b91c1c"];
const TYPED_FONTS: Array<{ id: string; label: string }> = [
  { id: "signature-flow", label: "Flowing" },
  { id: "signature-formal", label: "Formal" },
  { id: "times", label: "Serif" },
  { id: "helvetica", label: "Plain" },
];

const PAD_WIDTH = 520;
const PAD_HEIGHT = 190;

type Props = {
  open: boolean;
  role: "signature" | "initials";
  onOpenChange: (open: boolean) => void;
  onCreate: (signature: SavedSignature) => void;
};

const SignatureDialog = ({ open, role, onOpenChange, onCreate }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [typed, setTyped] = useState("");
  const [typedFont, setTypedFont] = useState(TYPED_FONTS[0].id);
  const [uploaded, setUploaded] = useState<{ data: Uint8Array; width: number; height: number } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("draw");

  useEffect(() => {
    if (!open) {
      setStrokes([]);
      setDrawing(null);
      setTyped("");
      setUploaded(null);
      setTab("draw");
    }
  }, [open]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = PAD_WIDTH * dpr;
    canvas.height = PAD_HEIGHT * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of [...strokes, ...(drawing ? [drawing] : [])]) {
      ctx.stroke(strokePath(stroke));
    }
  }, [drawing, inkColor, strokes]);

  useEffect(redraw, [redraw, open]);

  const pointFrom = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const raster = await imageFileToPng(file);
      if (!raster) return;
      // Photographs of a signature come with the paper attached; drop it.
      const cleaned = (await removeBackground(raster)) ?? raster;
      setUploaded(cleaned);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      let result: { data: Uint8Array; width: number; height: number } | null = null;
      if (tab === "draw") {
        result = await rasterizeStrokes(strokes, PAD_WIDTH, PAD_HEIGHT, inkColor, 2.6);
      } else if (tab === "type") {
        result = await rasterizeText(typed.trim(), {
          fontId: typedFont,
          fontSizePx: 72,
          color: inkColor,
        });
      } else {
        result = uploaded;
      }
      if (!result) return;
      onCreate({
        id: newId("sig"),
        data: result.data,
        mime: "image/png",
        aspect: result.width / Math.max(1, result.height),
        role,
        label: role === "initials" ? "Initials" : "Signature",
      });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const ready =
    (tab === "draw" && strokes.length > 0) ||
    (tab === "type" && typed.trim().length > 0) ||
    (tab === "upload" && !!uploaded);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {role === "initials" ? "Create your initials" : "Create your signature"}
          </DialogTitle>
          <DialogDescription>
            Drawn, typed or uploaded — it stays on this device and is only kept for as long as
            this tab is open.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="draw" className="gap-1.5">
              <PenLine className="h-4 w-4" /> Draw
            </TabsTrigger>
            <TabsTrigger value="type" className="gap-1.5">
              <Type className="h-4 w-4" /> Type
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5">
              <Upload className="h-4 w-4" /> Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="draw" className="space-y-3">
            <canvas
              ref={canvasRef}
              aria-label="Signature drawing area"
              className="w-full cursor-crosshair rounded-lg border border-dashed border-border bg-muted/20 touch-none"
              style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDrawing([pointFrom(event)]);
              }}
              onPointerMove={(event) => {
                if (!drawing) return;
                setDrawing([...drawing, pointFrom(event)]);
              }}
              onPointerUp={() => {
                if (drawing && drawing.length > 1) setStrokes((s) => [...s, drawing]);
                setDrawing(null);
              }}
              onPointerLeave={() => {
                if (drawing && drawing.length > 1) setStrokes((s) => [...s, drawing]);
                setDrawing(null);
              }}
            />
            <div className="flex items-center justify-between">
              <ColorPicker value={inkColor} onChange={setInkColor} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStrokes([])}
                disabled={strokes.length === 0}
              >
                <Eraser className="mr-1.5 h-4 w-4" /> Clear
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="type" className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="signature-text">Your name</Label>
              <Input
                id="signature-text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={role === "initials" ? "A.L." : "Ada Lovelace"}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TYPED_FONTS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  onClick={() => setTypedFont(font.id)}
                  className={cn(
                    "flex h-16 items-center justify-center rounded-lg border px-3 text-2xl transition-colors",
                    typedFont === font.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  )}
                  style={{ fontFamily: fontStack(font.id), color: inkColor }}
                >
                  <span className="truncate">{typed.trim() || font.label}</span>
                </button>
              ))}
            </div>
            <ColorPicker value={inkColor} onChange={setInkColor} />
          </TabsContent>

          <TabsContent value="upload" className="space-y-3">
            <Input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">
              A photo or scan works — the paper behind it is removed automatically.
            </p>
            {uploaded && (
              <div className="flex items-center justify-center rounded-lg border border-border bg-[repeating-conic-gradient(#f3f4f6_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
                <SignaturePreview data={uploaded.data} className="max-h-28" />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!ready || busy}>
            {busy ? "Working…" : "Use this"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Ink</span>
      {INK_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Ink colour ${color}`}
          onClick={() => onChange(color)}
          className={cn(
            "h-6 w-6 rounded-full border-2 transition-transform",
            value === color ? "scale-110 border-foreground" : "border-transparent"
          )}
          style={{ background: color }}
        />
      ))}
    </div>
  );
}

export function SignaturePreview({
  data,
  className,
}: {
  data: Uint8Array;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([data], { type: "image/png" }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);
  return url ? <img src={url} alt="Signature" className={className} /> : null;
}

export default SignatureDialog;
