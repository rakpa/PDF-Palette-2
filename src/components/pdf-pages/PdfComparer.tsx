import { useState } from "react";
import { AlertCircle, Loader2, RefreshCw, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { comparePdfs, CompareError, type CompareResult } from "@/lib/pdf-compare/compare";

const PdfComparer = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ready = files.length === 2;

  const run = async () => {
    if (!ready) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const [left, right] = await Promise.all(
        files.map(async (entry) => new Uint8Array(await entry.file.arrayBuffer()))
      );
      setResult(await comparePdfs(left, right, (_, message) => setStatus(message ?? "")));
    } catch (cause) {
      setError(
        cause instanceof CompareError || cause instanceof Error
          ? cause.message
          : "These files could not be compared."
      );
    } finally {
      setRunning(false);
      setStatus("");
    }
  };

  const changedPages = result?.pages.filter(
    (page) => page.onlyIn || (page.pixelChange ?? 0) > 0.002
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <FileUploader
        compact
        accept={{ "application/pdf": [".pdf"] }}
        maxFiles={2}
        files={files}
        onFilesChange={(next) => {
          setFiles(next);
          setResult(null);
          setError(null);
        }}
      />
      <p className="text-center text-sm text-muted-foreground">
        Add two PDFs — the original first, then the revision. Both stay on this device.
      </p>

      <div className="flex justify-center">
        <Button onClick={run} disabled={!ready || running}>
          {running ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Scale className="mr-1.5 h-4 w-4" />
          )}
          Compare
        </Button>
      </div>

      {running && status && (
        <p className="text-center text-sm text-muted-foreground">{status}</p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Words added", value: result.added, tone: "text-tool-green" },
              { label: "Words removed", value: result.removed, tone: "text-destructive" },
              { label: "Pages changed", value: changedPages?.length ?? 0, tone: "" },
              {
                label: "Page count",
                value:
                  result.leftPages === result.rightPages
                    ? `${result.leftPages}`
                    : `${result.leftPages} → ${result.rightPages}`,
                tone: result.leftPages === result.rightPages ? "" : "text-destructive",
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
                <div className={`text-xl font-semibold ${stat.tone}`}>{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>

          {result.added === 0 && result.removed === 0 && (changedPages?.length ?? 0) === 0 && (
            <div className="rounded-xl border border-border bg-card p-4 text-center text-sm">
              These two files are the same, page for page and word for word.
            </div>
          )}

          {(changedPages?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold">Pages that changed</h3>
              <div className="flex flex-wrap gap-2">
                {changedPages!.map((page) => (
                  <span
                    key={page.page}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs"
                  >
                    Page {page.page}
                    {page.onlyIn === "left" && " · removed"}
                    {page.onlyIn === "right" && " · added"}
                    {page.pixelChange !== undefined &&
                      ` · ${(page.pixelChange * 100).toFixed(1)}% of the page`}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">What changed in the text</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFiles([]);
                  setResult(null);
                }}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Start over
              </Button>
            </div>
            <p className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
              {result.parts.map((part, index) =>
                part.kind === "same" ? (
                  <span key={index} className="text-muted-foreground">
                    {part.text}{" "}
                  </span>
                ) : (
                  <mark
                    key={index}
                    className={
                      part.kind === "added"
                        ? "rounded bg-tool-green/20 px-0.5 text-foreground"
                        : "rounded bg-destructive/20 px-0.5 text-foreground line-through"
                    }
                  >
                    {part.text}{" "}
                  </mark>
                )
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default PdfComparer;
