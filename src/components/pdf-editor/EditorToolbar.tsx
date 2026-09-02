import {
  ArrowUpRight,
  Circle,
  Download,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Loader2,
  Minus,
  MousePointer2,
  PenLine,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EditorMode, EditorTool } from "@/lib/pdf-editor/types";

type ToolButton = { id: EditorTool; label: string; icon: typeof Type };

const EDIT_TOOLS: ToolButton[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "text", label: "Text", icon: Type },
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "draw", label: "Draw", icon: Pencil },
  { id: "highlight", label: "Highlight", icon: Highlighter },
  { id: "whiteout", label: "Erase", icon: Eraser },
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "signature", label: "Signature", icon: PenLine },
];

const SIGN_TOOLS: ToolButton[] = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "signature", label: "Signature", icon: PenLine },
  { id: "initials", label: "Initials", icon: Pencil },
  { id: "text", label: "Text", icon: Type },
  { id: "date", label: "Date", icon: CalendarDays },
];

type Props = {
  mode: EditorMode;
  tool: EditorTool;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  onToolChange: (tool: EditorTool) => void;
  onZoom: (delta: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
};

const EditorToolbar = ({
  mode,
  tool,
  zoom,
  canUndo,
  canRedo,
  busy,
  onToolChange,
  onZoom,
  onUndo,
  onRedo,
  onExport,
}: Props) => {
  const tools = mode === "sign" ? SIGN_TOOLS : EDIT_TOOLS;

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
      {tools.map(({ id, label, icon: Icon }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={tool === id ? "default" : "ghost"}
              size="sm"
              aria-pressed={tool === id}
              aria-label={label}
              className={cn("h-9 w-9 p-0", tool === id && "shadow-sm")}
              onClick={() => onToolChange(id)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="mx-1 h-6" />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-9 p-0"
        aria-label="Zoom out"
        onClick={() => onZoom(-0.15)}
      >
        <ZoomOut className="h-4 w-4" />
      </Button>
      <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 w-9 p-0"
        aria-label="Zoom in"
        onClick={() => onZoom(0.15)}
      >
        <ZoomIn className="h-4 w-4" />
      </Button>

      <div className="ml-auto">
        <Button type="button" size="sm" className="gap-1.5" disabled={busy} onClick={onExport}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {mode === "sign" ? "Sign & download" : "Save PDF"}
        </Button>
      </div>
    </div>
  );
};

export default EditorToolbar;
