import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { loadPdfForEditing, type LoadedPdf } from "@/lib/pdf-editor/document";
import {
  applyRedactions,
  DEFAULT_REDACT_FILL,
  findPhrase,
  readWords,
  RedactError,
  type RedactFill,
  type RedactionBox,
} from "@/lib/pdf-redact/redact";
import PageThumbnail from "./PageThumbnail";
import { cn } from "@/lib/utils";

type Words = Awaited<ReturnType<typeof readWords>>;

const FILL_PRESETS: { id: "auto" | "white" | "black"; label: string; color?: string }[] = [
  { id: "auto", label: "Match page" },
  { id: "white", label: "White", color: "#ffffff" },
  { id: "black", label: "Black", color: "#000000" },
];

const PdfRedactor = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [words, setWords] = useState<Words>([]);
  const [boxes, setBoxes] = useState<RedactionBox[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [phrase, setPhrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState<RedactFill>(DEFAULT_REDACT_FILL);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<RedactionBox | null>(null);
  const loadedRef = useRef<LoadedPdf | null>(null);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => () => loadedRef.current?.release(), []);

  const file = files[0]?.file;

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([loadPdfForEditing(file), file.arrayBuffer().then((b) => readWords(new Uint8Array(b)))])
      .then(([opened, found]) => {
        if (cancelled) {
          opened.release();
          return;
        }
        loadedRef.current?.release();
        setLoaded(opened);
        setWords(found);
        setBoxes([]);
        setPageIndex(0);
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause?.message ?? "This PDF could not be opened.";
        setError(
          /undefined is not a function|is not iterable|matchAll/i.test(message)
            ? "This PDF’s text layer could not be read. Try another export of the file, or draw redaction boxes on a simpler PDF."
            : message
        );
        setLoaded(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  const page = loaded?.pages[pageIndex];
  const pageBoxes = useMemo(
    () => boxes.filter((box) => box.page === pageIndex + 1),
    [boxes, pageIndex]
  );

  const pointAt = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const surface = surfaceRef.current;
      if (!surface || !page) return null;
      const rect = surface.getBoundingClientRect();
      if (rect.width < 1) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * page.width,
        y: ((event.clientY - rect.top) / rect.height) * page.height,
      };
    },
    [page]
  );

  const onMove = useCallback(
    (event: PointerEvent) => {
      const start = drawing.current;
      const at = pointAt(event);
      if (!start || !at) return;
      setDraft({
        page: pageIndex + 1,
        x: Math.min(start.x, at.x),
        y: Math.min(start.y, at.y),
        width: Math.abs(at.x - start.x),
        height: Math.abs(at.y - start.y),
      });
    },
    [pageIndex, pointAt]
  );

  const onUp = useCallback(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    drawing.current = null;
    setDraft((current) => {
      // A stray click is not a redaction.
      if (current && current.width > 3 && current.height > 3) {
        setBoxes((all) => [...all, current]);
      }
      return null;
    });
  }, [onMove]);

  const onDown = (event: React.PointerEvent) => {
    const at = pointAt(event);
    if (!at) return;
    event.preventDefault();
    drawing.current = at;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => () => onUp(), [onUp]);

  const search = () => {
    const found = findPhrase(words, phrase);
    if (found.length === 0) {
      toast.error(`No match for “${phrase.trim()}”.`);
      return;
    }
    setBoxes((all) => [...all, ...found]);
    toast.success(`Marked ${found.length} occurrence${found.length === 1 ? "" : "s"}.`);
  };

  const save = async () => {
    if (!loaded || !file) return;
    setSaving(true);
    try {
      const output = await applyRedactions(loaded.bytes, boxes, words, fill);
      const copy = new Uint8Array(output);
      saveAs(
        new Blob([copy], { type: "application/pdf" }),
        `${file.name.replace(/\.pdf$/i, "") || "document"}_redacted.pdf`
      );
      toast.success("Redacted. The removed content is gone from the file.");
    } catch (cause) {
      toast.error(
        cause instanceof RedactError || cause instanceof Error
          ? cause.message
          : "That didn't work."
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    loadedRef.current?.release();
    loadedRef.current = null;
    setLoaded(null);
    setFiles([]);
    setBoxes([]);
    setWords([]);
    setError(null);
  };

  if (!loaded || !page) {
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
        <p className="text-center text-sm text-muted-foreground">
          Drag over anything that has to go, or search for a phrase to mark every
          occurrence. The marked content is removed from the file, not just covered.
        </p>
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
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Previous page"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((n) => Math.max(0, n - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {loaded.pages.length}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Next page"
            disabled={pageIndex >= loaded.pages.length - 1}
            onClick={() => setPageIndex((n) => Math.min(loaded.pages.length - 1, n + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={boxes.length === 0}
            onClick={() => setBoxes([])}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Clear {boxes.length || ""}
          </Button>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Another file
          </Button>
          <Button size="sm" onClick={save} disabled={saving || boxes.length === 0}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Redact and download
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Redaction fill</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILL_PRESETS.map((preset) => {
              const active =
                preset.id === "auto"
                  ? fill.mode === "auto"
                  : fill.mode === "color" && fill.color.toLowerCase() === preset.color;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setFill(
                      preset.id === "auto"
                        ? { mode: "auto", color: fill.color }
                        : { mode: "color", color: preset.color || "#ffffff" }
                    )
                  }
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
            <label
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition",
                fill.mode === "color" &&
                  fill.color.toLowerCase() !== "#ffffff" &&
                  fill.color.toLowerCase() !== "#000000"
                  ? "border-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              <span
                className="h-4 w-4 rounded border border-border"
                style={{ backgroundColor: fill.color }}
              />
              Custom
              <input
                type="color"
                aria-label="Custom redaction colour"
                value={/^#[0-9a-fA-F]{6}$/.test(fill.color) ? fill.color : "#808080"}
                onChange={(event) => setFill({ mode: "color", color: event.target.value })}
                className="sr-only"
              />
            </label>
          </div>
        </div>
        <p className="max-w-sm text-xs text-muted-foreground">
          {fill.mode === "auto"
            ? "Match page paints each mark with the background around it — dark covers stay dark, white pages stay white."
            : "Every mark is filled with the colour you picked."}
        </p>
      </div>

      <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="redact-phrase" className="text-xs">
            Find and mark every occurrence
          </Label>
          <Input
            id="redact-phrase"
            placeholder="e.g. a name, an account number"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") search();
            }}
          />
        </div>
        <Button variant="outline" onClick={search} disabled={!phrase.trim()}>
          <Search className="mr-1.5 h-4 w-4" />
          Mark
        </Button>
      </div>

      <div className="flex justify-center rounded-xl border border-border bg-muted/30 p-4">
        <div
          ref={surfaceRef}
          onPointerDown={onDown}
          className="relative cursor-crosshair select-none bg-white"
          style={{
            height: "min(70vh, 720px)",
            aspectRatio: `${page.width} / ${page.height}`,
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <PageThumbnail proxy={loaded.proxy} sourceIndex={page.index} turn={0} size={1200} />
          </div>

          {[...pageBoxes, ...(draft ? [draft] : [])].map((box, index) => (
            <div
              key={index}
              className={cn(
                "pointer-events-none absolute ring-1",
                fill.mode === "auto"
                  ? "bg-slate-500/55 ring-slate-700/80"
                  : "ring-black/40"
              )}
              style={{
                left: `${(box.x / page.width) * 100}%`,
                top: `${(box.y / page.height) * 100}%`,
                width: `${(box.width / page.width) * 100}%`,
                height: `${(box.height / page.height) * 100}%`,
                ...(fill.mode === "color" ? { backgroundColor: fill.color } : null),
              }}
            />
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        A page you redact is rebuilt as a picture of itself with the marked areas painted
        out, so the removed words are not in the file at all. By default the paint matches
        the page background (dark cover → dark fill, white page → white fill); you can also
        force white, black, or a custom colour. Untouched pages are copied through as they were.
      </p>
    </div>
  );
};

export default PdfRedactor;
