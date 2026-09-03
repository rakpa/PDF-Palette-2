import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import {
  AlertCircle,
  CheckSquare,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { loadPdfForEditing, type LoadedPdf } from "@/lib/pdf-editor/document";
import { PdfPagesError, rebuildPages, type PagePlacement } from "@/lib/pdf-pages/organize";
import PageThumbnail from "./PageThumbnail";

export type OrganizerMode = "organize" | "remove" | "extract";

interface Page {
  id: string;
  sourceIndex: number;
  turn: number;
  picked: boolean;
}

const COPY: Record<OrganizerMode, { cta: string; hint: string; suffix: string }> = {
  organize: {
    cta: "Save organized PDF",
    hint: "Drag pages to reorder them. Rotate, duplicate or delete any page, then save.",
    suffix: "organized",
  },
  remove: {
    cta: "Remove selected pages",
    hint: "Select the pages you want to delete. Everything left keeps its order.",
    suffix: "removed",
  },
  extract: {
    cta: "Extract selected pages",
    hint: "Select the pages to pull out. They become a new PDF, in this order.",
    suffix: "extracted",
  },
};

let nextId = 0;
const newId = () => `p${++nextId}`;

/** Parse "1-3, 5, 8-10" into zero-based page indices. */
function parseSelection(input: string, total: number): number[] {
  const picked = new Set<number>();
  for (const chunk of input.split(",")) {
    const text = chunk.trim();
    if (!text) continue;
    const [a, b] = text.split("-").map((n) => Number.parseInt(n.trim(), 10));
    if (Number.isNaN(a)) continue;
    // A lone page has no second number at all, and `Number.isNaN` says
    // nothing about `undefined` — so test for it before falling back.
    const end = b === undefined || Number.isNaN(b) ? a : b;
    for (let n = Math.max(1, a); n <= Math.min(total, end); n++) picked.add(n - 1);
  }
  return [...picked].sort((x, y) => x - y);
}

const PageOrganizer = ({ mode }: { mode: OrganizerMode }) => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranges, setRanges] = useState("");
  const dragging = useRef<string | null>(null);
  const loadedRef = useRef<LoadedPdf | null>(null);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => () => loadedRef.current?.release(), []);

  const file = files[0]?.file;
  const copy = COPY[mode];
  const selecting = mode !== "organize";

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadPdfForEditing(file)
      .then((result) => {
        if (cancelled) {
          result.release();
          return;
        }
        loadedRef.current?.release();
        setLoaded(result);
        setPages(
          result.pages.map((page) => ({
            id: newId(),
            sourceIndex: page.index,
            turn: 0,
            picked: false,
          }))
        );
        setRanges("");
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause?.message ?? "This PDF could not be opened.");
        setLoaded(null);
        setPages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Typing a range and clicking thumbnails should stay in step.
  const applyRanges = useCallback(
    (text: string) => {
      setRanges(text);
      const picked = new Set(parseSelection(text, pages.length));
      setPages((current) =>
        current.map((page, index) => ({ ...page, picked: picked.has(index) }))
      );
    },
    [pages.length]
  );

  const toggle = (id: string) => {
    setPages((current) => {
      const next = current.map((page) =>
        page.id === id ? { ...page, picked: !page.picked } : page
      );
      setRanges(
        next
          .map((page, index) => (page.picked ? index + 1 : 0))
          .filter(Boolean)
          .join(", ")
      );
      return next;
    });
  };

  const rotate = (id: string) =>
    setPages((current) =>
      current.map((page) => (page.id === id ? { ...page, turn: (page.turn + 90) % 360 } : page))
    );

  const duplicate = (id: string) =>
    setPages((current) => {
      const at = current.findIndex((page) => page.id === id);
      if (at < 0) return current;
      const copyOf = { ...current[at], id: newId(), picked: false };
      return [...current.slice(0, at + 1), copyOf, ...current.slice(at + 1)];
    });

  const drop = (id: string) => {
    const from = dragging.current;
    dragging.current = null;
    if (!from || from === id) return;
    setPages((current) => {
      const start = current.findIndex((page) => page.id === from);
      const end = current.findIndex((page) => page.id === id);
      if (start < 0 || end < 0) return current;
      const next = [...current];
      const [moved] = next.splice(start, 1);
      next.splice(end, 0, moved);
      return next;
    });
  };

  const remove = (id: string) =>
    setPages((current) =>
      current.length > 1 ? current.filter((page) => page.id !== id) : current
    );

  const pickedCount = useMemo(() => pages.filter((page) => page.picked).length, [pages]);

  const canSave =
    !!loaded &&
    !saving &&
    (mode === "organize"
      ? pages.length > 0
      : mode === "remove"
        ? pickedCount > 0 && pickedCount < pages.length
        : pickedCount > 0);

  const save = async () => {
    if (!loaded || !file) return;
    setSaving(true);
    try {
      const plan: PagePlacement[] =
        mode === "organize"
          ? pages.map((page) => ({ source: page.sourceIndex, turn: page.turn }))
          : mode === "remove"
            ? pages.filter((page) => !page.picked).map((page) => ({ source: page.sourceIndex }))
            : pages.filter((page) => page.picked).map((page) => ({ source: page.sourceIndex }));

      const bytes = await rebuildPages(loaded.bytes, plan);
      const base = file.name.replace(/\.pdf$/i, "") || "document";
      saveAs(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
        `${base}_${copy.suffix}.pdf`
      );
      toast.success(`Saved ${plan.length} page${plan.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      const message =
        cause instanceof PdfPagesError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "That didn't work.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    loadedRef.current?.release();
    loadedRef.current = null;
    setLoaded(null);
    setPages([]);
    setFiles([]);
    setError(null);
    setRanges("");
  };

  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <FileUploader
          compact
          accept={{ "application/pdf": [".pdf"] }}
          maxFiles={1}
          files={files}
          onFilesChange={(next) => {
            setFiles(next);
            setError(null);
          }}
        />
        <p className="text-center text-sm text-muted-foreground">{copy.hint}</p>
        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening PDF…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div className="text-sm text-muted-foreground">
          {pages.length} page{pages.length === 1 ? "" : "s"}
          {selecting ? ` · ${pickedCount} selected` : ""}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selecting && (
            <>
              <div className="flex items-center gap-2">
                <Label htmlFor="page-ranges" className="text-xs text-muted-foreground">
                  Pages
                </Label>
                <Input
                  id="page-ranges"
                  className="h-9 w-40"
                  placeholder="1-3, 7, 10"
                  value={ranges}
                  onChange={(event) => applyRanges(event.target.value)}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const all = pickedCount !== pages.length;
                  setPages((current) => current.map((page) => ({ ...page, picked: all })));
                  setRanges(all ? `1-${pages.length}` : "");
                }}
              >
                {pickedCount === pages.length ? (
                  <Square className="mr-1.5 h-4 w-4" />
                ) : (
                  <CheckSquare className="mr-1.5 h-4 w-4" />
                )}
                {pickedCount === pages.length ? "Clear" : "Select all"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Another file
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {copy.cta}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{copy.hint}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {pages.map((page, index) => (
          <div
            key={page.id}
            draggable={mode === "organize"}
            onDragStart={() => {
              dragging.current = page.id;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => drop(page.id)}
            onClick={() => selecting && toggle(page.id)}
            className={`group relative flex flex-col items-center gap-2 rounded-xl border-2 bg-card p-2 transition ${
              selecting ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
            } ${
              page.picked
                ? mode === "remove"
                  ? "border-destructive bg-destructive/5"
                  : "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
              <PageThumbnail
                proxy={loaded.proxy}
                sourceIndex={page.sourceIndex}
                turn={page.turn}
                size={200}
              />
            </div>

            <div className="flex w-full items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{index + 1}</span>
              {mode === "organize" && (
                <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Rotate page ${index + 1}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      rotate(page.id);
                    }}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Duplicate page ${index + 1}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      duplicate(page.id);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    aria-label={`Delete page ${index + 1}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(page.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PageOrganizer;
