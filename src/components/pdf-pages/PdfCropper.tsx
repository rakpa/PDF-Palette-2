import { useCallback, useEffect, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { AlertCircle, ChevronLeft, ChevronRight, Crop, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { loadPdfForEditing, type LoadedPdf } from "@/lib/pdf-editor/document";
import { cropPages, NO_CROP, type CropInsets } from "@/lib/pdf-pages/crop";
import { PdfPagesError } from "@/lib/pdf-pages/organize";
import PageThumbnail from "./PageThumbnail";

type Handle = "move" | "nw" | "ne" | "sw" | "se";

const MIN_SPAN = 0.06;

/** The crop box as fractions of the page: left/top/right/bottom insets. */
function clampInsets(insets: CropInsets): CropInsets {
  const left = Math.max(0, Math.min(insets.left, 1 - MIN_SPAN));
  const right = Math.max(0, Math.min(insets.right, 1 - MIN_SPAN - left));
  const top = Math.max(0, Math.min(insets.top, 1 - MIN_SPAN));
  const bottom = Math.max(0, Math.min(insets.bottom, 1 - MIN_SPAN - top));
  return { left, right, top, bottom };
}

const PdfCropper = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [insets, setInsets] = useState<CropInsets>(NO_CROP);
  const [allPages, setAllPages] = useState(true);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; x: number; y: number; start: CropInsets } | null>(null);
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
    loadPdfForEditing(file)
      .then((result) => {
        if (cancelled) {
          result.release();
          return;
        }
        loadedRef.current?.release();
        setLoaded(result);
        setPageIndex(0);
        setInsets(NO_CROP);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause?.message ?? "This PDF could not be opened.");
        setLoaded(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const state = drag.current;
    const surface = surfaceRef.current;
    if (!state || !surface) return;
    const rect = surface.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const dx = (event.clientX - state.x) / rect.width;
    const dy = (event.clientY - state.y) / rect.height;
    const from = state.start;

    if (state.handle === "move") {
      // Sliding the window keeps its size: whatever one edge gains, the
      // opposite edge gives up.
      const width = 1 - from.left - from.right;
      const height = 1 - from.top - from.bottom;
      const left = Math.max(0, Math.min(from.left + dx, 1 - width));
      const top = Math.max(0, Math.min(from.top + dy, 1 - height));
      setInsets({ left, top, right: 1 - width - left, bottom: 1 - height - top });
      return;
    }

    const next = { ...from };
    if (state.handle.includes("w")) next.left = from.left + dx;
    if (state.handle.includes("e")) next.right = from.right - dx;
    if (state.handle.includes("n")) next.top = from.top + dy;
    if (state.handle.includes("s")) next.bottom = from.bottom - dy;
    setInsets(clampInsets(next));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startDrag = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    drag.current = { handle, x: event.clientX, y: event.clientY, start: insets };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  useEffect(() => () => endDrag(), [endDrag]);

  const cropped = insets.left + insets.right + insets.top + insets.bottom > 0.001;

  const save = async () => {
    if (!loaded || !file) return;
    if (!cropped) {
      toast.error("Drag the crop box in from an edge first.");
      return;
    }
    setSaving(true);
    try {
      const bytes = await cropPages(loaded.bytes, {
        insets,
        fromPage: allPages ? 1 : pageIndex + 1,
        toPage: allPages ? 0 : pageIndex + 1,
      });
      const base = file.name.replace(/\.pdf$/i, "") || "document";
      saveAs(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
        `${base}_cropped.pdf`
      );
      toast.success(allPages ? "Cropped every page." : `Cropped page ${pageIndex + 1}.`);
    } catch (cause) {
      toast.error(
        cause instanceof PdfPagesError || cause instanceof Error
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
    setError(null);
    setInsets(NO_CROP);
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
        <p className="text-center text-sm text-muted-foreground">
          Drag the crop box to set the visible area. The content is kept — cropping changes
          what the page shows, so it can always be widened again.
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

  const page = loaded.pages[pageIndex];
  const portrait = page.height >= page.width;

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

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="crop-all" checked={allPages} onCheckedChange={setAllPages} />
            <Label htmlFor="crop-all" className="text-sm">
              Every page
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setInsets(NO_CROP)}>
            <Crop className="mr-1.5 h-4 w-4" />
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Another file
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !cropped}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Crop PDF
          </Button>
        </div>
      </div>

      <div className="flex justify-center rounded-xl border border-border bg-muted/30 p-4">
        <div
          ref={surfaceRef}
          className="relative select-none"
          style={{
            width: portrait ? "auto" : "100%",
            height: portrait ? "min(70vh, 640px)" : "auto",
            aspectRatio: `${page.width} / ${page.height}`,
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <PageThumbnail proxy={loaded.proxy} sourceIndex={page.index} turn={0} size={1000} />
          </div>

          {/* Everything outside the box is dimmed, so the kept area reads at a glance. */}
          <div className="pointer-events-none absolute inset-0 bg-slate-900/45" />
          <div
            className="absolute cursor-move overflow-hidden ring-2 ring-primary"
            style={{
              left: `${insets.left * 100}%`,
              top: `${insets.top * 100}%`,
              right: `${insets.right * 100}%`,
              bottom: `${insets.bottom * 100}%`,
            }}
            onPointerDown={startDrag("move")}
          >
            <div
              className="absolute bg-white"
              style={{
                left: `${-insets.left * 100}%`,
                top: `${-insets.top * 100}%`,
                width: `${100 / Math.max(0.01, 1 - insets.left - insets.right)}%`,
                height: `${100 / Math.max(0.01, 1 - insets.top - insets.bottom)}%`,
              }}
            >
              <div className="flex h-full w-full items-center justify-center">
                <PageThumbnail
                  proxy={loaded.proxy}
                  sourceIndex={page.index}
                  turn={0}
                  size={1000}
                />
              </div>
            </div>
          </div>

          {(["nw", "ne", "sw", "se"] as const).map((handle) => (
            <div
              key={handle}
              onPointerDown={startDrag(handle)}
              className="absolute h-4 w-4 rounded-sm border-2 border-primary bg-background"
              style={{
                left: handle.includes("w") ? `calc(${insets.left * 100}% - 8px)` : undefined,
                right: handle.includes("e") ? `calc(${insets.right * 100}% - 8px)` : undefined,
                top: handle.includes("n") ? `calc(${insets.top * 100}% - 8px)` : undefined,
                bottom: handle.includes("s") ? `calc(${insets.bottom * 100}% - 8px)` : undefined,
                cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default PdfCropper;
