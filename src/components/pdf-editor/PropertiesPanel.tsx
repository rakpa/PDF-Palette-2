import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Italic,
  Layers,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { fontStack } from "@/lib/pdf-editor/raster";
import type { Annotation, FontId, TextAlign } from "@/lib/pdf-editor/types";

const PALETTE = [
  "#111827",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#ffffff",
];

const HIGHLIGHT_PALETTE = ["#fde047", "#86efac", "#93c5fd", "#f9a8d4", "#fdba74"];

const FONTS: Array<{ id: FontId; label: string }> = [
  { id: "helvetica", label: "Sans" },
  { id: "times", label: "Serif" },
  { id: "courier", label: "Mono" },
  { id: "signature-flow", label: "Script" },
];

type Props = {
  annotation: Annotation | null;
  onChange: (patch: Partial<Annotation>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReorder: (to: "front" | "back") => void;
};

function Swatches({
  colors,
  value,
  onChange,
  label,
}: {
  colors: string[];
  value?: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${label} ${color}`}
            onClick={() => onChange(color)}
            className={cn(
              "h-6 w-6 rounded-md border transition-transform",
              value?.toLowerCase() === color.toLowerCase()
                ? "scale-110 border-foreground ring-1 ring-foreground"
                : "border-border"
            )}
            style={{ background: color }}
          />
        ))}
      </div>
    </div>
  );
}

const PropertiesPanel = ({ annotation, onChange, onDelete, onDuplicate, onReorder }: Props) => {
  if (!annotation) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Pick a tool above, then click or drag on the page. Select something to change how it
        looks.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium capitalize">
          {annotation.kind === "image" && annotation.role !== "image"
            ? annotation.role
            : annotation.kind}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Bring to front"
            onClick={() => onReorder("front")}
          >
            <Layers className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Duplicate"
            onClick={onDuplicate}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive"
            aria-label="Delete"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {annotation.kind === "text" && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1.5">
            {FONTS.map((font) => (
              <button
                key={font.id}
                type="button"
                onClick={() => onChange({ fontId: font.id })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs transition-colors",
                  annotation.fontId === font.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
                style={{ fontFamily: fontStack(font.id) }}
              >
                {font.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Size · {annotation.fontSize}pt</Label>
            <Slider
              value={[annotation.fontSize]}
              min={6}
              max={72}
              step={1}
              onValueChange={([v]) => onChange({ fontSize: v })}
            />
          </div>

          <div className="flex gap-1.5">
            <Button
              type="button"
              variant={annotation.bold ? "default" : "outline"}
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Bold"
              aria-pressed={annotation.bold}
              onClick={() => onChange({ bold: !annotation.bold })}
            >
              <Bold className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={annotation.italic ? "default" : "outline"}
              size="sm"
              className="h-8 w-8 p-0"
              aria-label="Italic"
              aria-pressed={annotation.italic}
              onClick={() => onChange({ italic: !annotation.italic })}
            >
              <Italic className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-8" />
            {(
              [
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ] as Array<[TextAlign, typeof AlignLeft]>
            ).map(([align, Icon]) => (
              <Button
                key={align}
                type="button"
                variant={annotation.align === align ? "default" : "outline"}
                size="sm"
                className="h-8 w-8 p-0"
                aria-label={`Align ${align}`}
                aria-pressed={annotation.align === align}
                onClick={() => onChange({ align })}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>

          <Swatches
            label="Colour"
            colors={PALETTE}
            value={annotation.color}
            onChange={(color) => onChange({ color })}
          />
        </div>
      )}

      {annotation.kind === "shape" && (
        <div className="space-y-3">
          <Swatches
            label="Line"
            colors={PALETTE}
            value={annotation.stroke}
            onChange={(stroke) => onChange({ stroke })}
          />
          {(annotation.shape === "rectangle" || annotation.shape === "ellipse") && (
            <div className="space-y-1.5">
              <Swatches
                label="Fill"
                colors={PALETTE}
                value={annotation.fill}
                onChange={(fill) => onChange({ fill })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onChange({ fill: undefined })}
              >
                No fill
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Thickness · {annotation.strokeWidth}pt</Label>
            <Slider
              value={[annotation.strokeWidth]}
              min={0.5}
              max={12}
              step={0.5}
              onValueChange={([v]) => onChange({ strokeWidth: v })}
            />
          </div>
          <OpacitySlider
            value={annotation.opacity}
            onChange={(opacity) => onChange({ opacity })}
          />
        </div>
      )}

      {annotation.kind === "ink" && (
        <div className="space-y-3">
          <Swatches
            label="Ink"
            colors={PALETTE}
            value={annotation.stroke}
            onChange={(stroke) => onChange({ stroke })}
          />
          <div className="space-y-1.5">
            <Label className="text-xs">Thickness · {annotation.strokeWidth}pt</Label>
            <Slider
              value={[annotation.strokeWidth]}
              min={0.5}
              max={12}
              step={0.5}
              onValueChange={([v]) => onChange({ strokeWidth: v })}
            />
          </div>
          <OpacitySlider
            value={annotation.opacity}
            onChange={(opacity) => onChange({ opacity })}
          />
        </div>
      )}

      {annotation.kind === "highlight" && (
        <Swatches
          label="Colour"
          colors={HIGHLIGHT_PALETTE}
          value={annotation.color}
          onChange={(color) => onChange({ color })}
        />
      )}

      {annotation.kind === "whiteout" && (
        <Swatches
          label="Colour"
          colors={["#ffffff", "#f8fafc", "#f1f5f9"]}
          value={annotation.color}
          onChange={(color) => onChange({ color })}
        />
      )}

      {annotation.kind === "image" && (
        <OpacitySlider value={annotation.opacity} onChange={(opacity) => onChange({ opacity })} />
      )}
    </div>
  );
};

function OpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Opacity · {Math.round(value * 100)}%</Label>
      <Slider
        value={[value]}
        min={0.1}
        max={1}
        step={0.05}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

export default PropertiesPanel;
