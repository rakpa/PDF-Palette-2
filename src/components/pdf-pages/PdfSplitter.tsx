import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { saveAs } from "file-saver";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Files,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  RectangleHorizontal,
  Scissors,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { loadPdfForEditing, type LoadedPdf } from "@/lib/pdf-editor/document";
import {
  downloadResult,
  splitPDF,
  type ProcessingResult,
  type SplitRange,
} from "@/lib/pdf-utils";
import { createZip } from "@/lib/zip-write";
import { cn } from "@/lib/utils";
import PageThumbnail from "./PageThumbnail";

type SplitTab = "range" | "pages";
type RangeKind = "custom" | "fixed";
type ExtractMode = "all" | "select";

type RangeRow = { id: number; from: number; to: number };

let nextRangeId = 0;
const newRangeId = () => ++nextRangeId;

function clampPage(value: number, total: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(total, Math.max(1, Math.round(value)));
}

function fixedRanges(total: number, every: number): SplitRange[] {
  const size = Math.max(1, Math.floor(every) || 1);
  const ranges: SplitRange[] = [];
  for (let start = 1; start <= total; start += size) {
    ranges.push({ start, end: Math.min(total, start + size - 1) });
  }
  return ranges;
}

function parsePage(raw: string, fallback: number, total: number): number {
  const n = Number.parseInt(raw, 10);
  return clampPage(Number.isNaN(n) ? fallback : n, total);
}

const PdfSplitter = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SplitTab>("range");
  const [rangeKind, setRangeKind] = useState<RangeKind>("custom");
  const [rows, setRows] = useState<RangeRow[]>([{ id: newRangeId(), from: 1, to: 1 }]);
  const [mergeRanges, setMergeRanges] = useState(false);
  const [every, setEvery] = useState(1);
  const [extractMode, setExtractMode] = useState<ExtractMode>("all");
  const [picked, setPicked] = useState<boolean[]>([]);
  const loadedRef = useRef<LoadedPdf | null>(null);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => () => loadedRef.current?.release(), []);

  const file = files[0]?.file;
  const pageCount = loaded?.pages.length ?? 0;

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
        const total = result.pages.length;
        setRows([{ id: newRangeId(), from: 1, to: total }]);
        setPicked(Array.from({ length: total }, () => true));
        setExtractMode("all");
        setTab("range");
        setRangeKind("custom");
        setMergeRanges(false);
        setEvery(1);
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

  const customRanges = useMemo(
    () =>
      rows
        .map((row) => {
          const start = Math.min(row.from, row.to);
          const end = Math.max(row.from, row.to);
          return { start, end };
        })
        .filter((range) => range.start >= 1 && range.end >= range.start),
    [rows]
  );

  const pageRanges = useMemo((): SplitRange[] => {
    return picked
      .map((on, index) => (on ? { start: index + 1, end: index + 1 } : null))
      .filter((range): range is SplitRange => range !== null);
  }, [picked]);

  const activeRanges = useMemo(() => {
    if (tab === "pages") return pageRanges;
    if (rangeKind === "fixed") return fixedRanges(pageCount, every);
    return customRanges;
  }, [tab, pageRanges, rangeKind, pageCount, every, customRanges]);

  const willMerge = tab === "range" && mergeRanges;
  const outputCount = willMerge ? (activeRanges.length > 0 ? 1 : 0) : activeRanges.length;
  const pickedCount = picked.filter(Boolean).length;

  const canSplit = !!loaded && !!file && !saving && outputCount > 0;

  const setExtract = (mode: ExtractMode) => {
    setExtractMode(mode);
    if (mode === "all") {
      setPicked((current) => current.map(() => true));
    }
  };

  const togglePage = (index: number) => {
    if (tab !== "pages") setTab("pages");
    setExtractMode("select");
    setPicked((current) => current.map((on, i) => (i === index ? !on : on)));
  };

  const updateRow = (id: number, key: "from" | "to", raw: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, [key]: parsePage(raw, row[key], pageCount) } : row
      )
    );
  };

  const moveRow = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= rows.length) return;
    setRows((current) => {
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  };

  const split = async () => {
    if (!file || !loaded) return;
    setSaving(true);
    try {
      const base = file.name.replace(/\.pdf$/i, "") || "document";
      const results = await splitPDF(file, activeRanges, undefined, {
        merge: willMerge,
        baseName: base,
      });
      const ok = results.filter((r) => r.success && r.blob);
      if (ok.length === 0) {
        toast.error(results[0]?.message ?? "Nothing to extract.");
        return;
      }
      await downloadSplits(ok, base);
      toast.success(
        ok.length === 1
          ? results[0]?.message ?? "Download started."
          : `Created ${ok.length} PDFs — download started.`
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That didn't work.");
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
    setPicked([]);
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
          Split a PDF by page ranges or into one file per page.
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
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <span>
            {pageCount} page{pageCount === 1 ? "" : "s"}
            {tab === "pages" ? ` · ${pickedCount} selected` : ""}
          </span>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Another file
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {loaded.pages.map((page, index) => {
            const selected = tab === "pages" ? picked[index] : false;
            return (
              <button
                key={page.index}
                type="button"
                onClick={() => togglePage(index)}
                className={cn(
                  "group relative flex flex-col items-center gap-2 rounded-xl border-2 bg-card p-2 text-left transition",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                )}
              >
                {selected && (
                  <span className="absolute left-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
                <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-md bg-muted/40">
                  <PageThumbnail
                    proxy={loaded.proxy}
                    sourceIndex={page.index}
                    turn={0}
                    size={200}
                  />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{index + 1}</span>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="w-full shrink-0 rounded-xl border border-border bg-card lg:sticky lg:top-4 lg:w-80">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-foreground">Split</h2>
        </div>

        <div className="space-y-5 p-4">
          <div className="grid grid-cols-2 gap-2">
            <ModeTab
              active={tab === "range"}
              label="Range"
              onClick={() => setTab("range")}
              icon={<RectangleHorizontal className="h-6 w-6" />}
            />
            <ModeTab
              active={tab === "pages"}
              label="Pages"
              onClick={() => setTab("pages")}
              icon={<Files className="h-6 w-6" />}
            />
          </div>

          {tab === "range" ? (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Range mode:</p>
                <div className="grid grid-cols-2 gap-2">
                  <KindButton
                    active={rangeKind === "custom"}
                    onClick={() => setRangeKind("custom")}
                    label="Custom"
                  />
                  <KindButton
                    active={rangeKind === "fixed"}
                    onClick={() => setRangeKind("fixed")}
                    label="Fixed"
                  />
                </div>
              </div>

              {rangeKind === "custom" ? (
                <div className="space-y-3">
                  {rows.map((row, index) => (
                    <div key={row.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-sm font-medium">
                          <div className="flex flex-col">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={index === 0}
                              aria-label="Move range up"
                              onClick={() => moveRow(index, -1)}
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={index === rows.length - 1}
                              aria-label="Move range down"
                              onClick={() => moveRow(index, 1)}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          Range {index + 1}
                        </div>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive"
                            aria-label={`Remove range ${index + 1}`}
                            onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">from page</Label>
                          <Input
                            type="number"
                            min={1}
                            max={pageCount}
                            value={row.from}
                            onChange={(event) => updateRow(row.id, "from", event.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">to</Label>
                          <Input
                            type="number"
                            min={1}
                            max={pageCount}
                            value={row.to}
                            onChange={(event) => updateRow(row.id, "to", event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-primary text-primary hover:bg-primary/5 hover:text-primary"
                    onClick={() =>
                      setRows((current) => [
                        ...current,
                        { id: newRangeId(), from: 1, to: pageCount },
                      ])
                    }
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add Range
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="split-every">Split every</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="split-every"
                      type="number"
                      min={1}
                      max={pageCount}
                      value={every}
                      onChange={(event) =>
                        setEvery(parsePage(event.target.value, every, pageCount))
                      }
                    />
                    <span className="text-sm text-muted-foreground">pages</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Creates {fixedRanges(pageCount, every).length} file
                    {fixedRanges(pageCount, every).length === 1 ? "" : "s"}.
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2 text-sm leading-snug">
                <Checkbox
                  checked={mergeRanges}
                  onCheckedChange={(value) => setMergeRanges(value === true)}
                  className="mt-0.5"
                />
                <span>Merge all ranges in one PDF file.</span>
              </label>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Extract mode:</p>
                <div className="grid grid-cols-2 gap-2">
                  <KindButton
                    active={extractMode === "all"}
                    onClick={() => setExtract("all")}
                    label="Extract all pages"
                  />
                  <KindButton
                    active={extractMode === "select"}
                    onClick={() => setExtract("select")}
                    label="Select pages"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Selected pages will be converted into separate PDF files.{" "}
                  <strong>
                    {outputCount} PDF{outputCount === 1 ? "" : "s"}
                  </strong>{" "}
                  will be created.
                </p>
              </div>
              {extractMode === "select" && pickedCount === 0 && (
                <p className="text-sm text-destructive">Select at least one page.</p>
              )}
            </>
          )}

          <Button className="w-full" size="lg" onClick={split} disabled={!canSplit}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Scissors className="mr-2 h-4 w-4" />
            )}
            Split PDF
          </Button>
        </div>
      </aside>
    </div>
  );
};

function ModeTab({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border bg-muted/40 text-muted-foreground hover:border-primary/40"
      )}
    >
      {active && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
      )}
      {icon}
      {label}
    </button>
  );
}

function KindButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2 py-2.5 text-sm font-medium transition",
        active
          ? "border-primary bg-background text-primary"
          : "border-transparent bg-muted text-muted-foreground hover:bg-muted/80"
      )}
    >
      {label}
    </button>
  );
}

async function downloadSplits(results: ProcessingResult[], base: string) {
  if (results.length === 1) {
    downloadResult(results[0]);
    return;
  }
  const entries = [];
  for (const result of results) {
    if (!result.blob || !result.filename) continue;
    entries.push({
      name: result.filename,
      data: new Uint8Array(await result.blob.arrayBuffer()),
    });
  }
  const zip = await createZip(entries);
  saveAs(new Blob([zip as unknown as BlobPart], { type: "application/zip" }), `${base}_split.zip`);
}

export default PdfSplitter;
