import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Download, Loader2, RotateCw } from "lucide-react";
import type { WebViewerInstance } from "@pdftron/webviewer";

import FileUploader, { UploadedFile } from "@/components/FileUploader";
import ProgressBar from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { downloadResult, pdfToWord, ProcessingResult } from "@/lib/pdf-utils";
import { hasApryseLicense, loadBlob, mountApryseViewer } from "@/lib/apryse-viewer";
import { cn } from "@/lib/utils";

type Pane = "source" | "converted";

/**
 * PDF → Word with a look at the result before downloading it. The conversion is
 * the same one the standard tool runs; what this adds is Apryse WebViewer, which
 * renders both the source PDF and the converted .docx client-side.
 *
 * One viewer instance, toggled between the two documents, rather than two panes
 * side by side: each instance loads its own copy of the wasm, and flipping A/B
 * in a single viewport makes layout drift far easier to see than comparing two
 * half-width panes.
 */
const PdfToWordApryse = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [pane, setPane] = useState<Pane>("converted");
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<WebViewerInstance | null>(null);
  const sourceRef = useRef<File | null>(null);

  // The viewer is mounted once, on first result, and reused for both documents.
  useEffect(() => {
    if (!result?.blob || !hostRef.current || instanceRef.current) return;

    let cancelled = false;
    let dispose: (() => void) | undefined;

    mountApryseViewer(hostRef.current)
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        instanceRef.current = handle.instance;
        dispose = handle.dispose;
        setViewerReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setViewerError(
          error instanceof Error ? error.message : "WebViewer failed to load."
        );
      });

    return () => {
      cancelled = true;
      dispose?.();
      instanceRef.current = null;
    };
  }, [result]);

  // Whichever pane is selected is what the single instance has loaded.
  useEffect(() => {
    const instance = instanceRef.current;
    if (!viewerReady || !instance) return;

    if (pane === "source" && sourceRef.current) {
      loadBlob(instance, sourceRef.current, sourceRef.current.name, "pdf");
    } else if (pane === "converted" && result?.blob) {
      loadBlob(instance, result.blob, result.filename ?? "converted.docx", "docx");
    }
  }, [pane, viewerReady, result]);

  const convert = useCallback(async () => {
    const file = files[0]?.file;
    if (!file) return;

    setConverting(true);
    setProgress(0);
    setStatus("Starting conversion…");
    setResult(null);
    setViewerError(null);

    try {
      const res = await pdfToWord(file, (p, message) => {
        setProgress(p);
        if (message) setStatus(message);
      });

      if (!res.success || !res.blob) {
        toast.error(res.message);
        return;
      }

      sourceRef.current = file;
      setResult(res);
      setPane("converted");
      toast.success("Converted — check the preview before downloading.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conversion failed.");
    } finally {
      setConverting(false);
    }
  }, [files]);

  const reset = () => {
    setFiles([]);
    setResult(null);
    setViewerReady(false);
    sourceRef.current = null;
  };

  return (
    <div className="space-y-6">
      {!result && (
        <>
          <FileUploader
            accept={{ "application/pdf": [".pdf"] }}
            maxFiles={1}
            files={files}
            onFilesChange={setFiles}
          />

          {converting ? (
            <ProgressBar progress={progress} showLabel label={status} />
          ) : (
            <Button
              className="w-full"
              size="lg"
              disabled={files.length === 0}
              onClick={convert}
            >
              Convert and preview
            </Button>
          )}
        </>
      )}

      {result && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-border p-1">
              {(["source", "converted"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPane(key)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    pane === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {key === "source" ? "Original PDF" : "Converted .docx"}
                </button>
              ))}
            </div>

            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={reset}>
                <RotateCw className="mr-2 h-4 w-4" />
                New file
              </Button>
              <Button onClick={() => downloadResult(result)}>
                <Download className="mr-2 h-4 w-4" />
                Download .docx
              </Button>
            </div>
          </div>

          {viewerError ? (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">Preview unavailable</p>
                <p className="text-muted-foreground">{viewerError}</p>
                <p className="mt-1 text-muted-foreground">
                  The converted file is fine — download it above.
                </p>
              </div>
            </div>
          ) : (
            <div className="relative h-[70vh] overflow-hidden rounded-lg border border-border">
              {!viewerReady && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading viewer…
                </div>
              )}
              <div ref={hostRef} className="h-full w-full" />
            </div>
          )}

          {!hasApryseLicense && (
            <p className="text-xs text-muted-foreground">
              No Apryse licence key is configured, so WebViewer stamps a demo
              watermark on what it renders. The watermark is not in the .docx you
              download.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default PdfToWordApryse;
