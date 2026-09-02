import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { AlertCircle, Loader2, PenLine, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import {
  PdfEditorError,
  displaySize,
  initialPages,
  loadPdfForEditing,
  type LoadedPdf,
} from "@/lib/pdf-editor/document";
import { exportEditedPdf } from "@/lib/pdf-editor/export";
import { imageFileToPng } from "@/lib/pdf-editor/raster";
import { DEFAULT_TEXT, newId, useEditorDocument, useSignatureLibrary } from "@/lib/pdf-editor/state";
import type {
  Annotation,
  Box,
  EditorMode,
  EditorPage,
  EditorTool,
  Point,
  SavedSignature,
} from "@/lib/pdf-editor/types";
import EditorPageView from "./EditorPageView";
import EditorToolbar from "./EditorToolbar";
import PageRail from "./PageRail";
import PropertiesPanel from "./PropertiesPanel";
import SignatureDialog, { SignaturePreview } from "./SignatureDialog";

const DEFAULT_SIGNATURE_WIDTH = 180;

type Props = { mode: EditorMode };

const PdfEditor = ({ mode }: Props) => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [zoom, setZoom] = useState(1);
  // Auto-fit stops as soon as the reader zooms themselves.
  const [userZoomed, setUserZoomed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [signatureDialog, setSignatureDialog] = useState<null | "signature" | "initials">(null);
  const [strokeColor, setStrokeColor] = useState("#111827");
  const [strokeWidth, setStrokeWidth] = useState(2.5);

  const doc = useEditorDocument();
  const signatures = useSignatureLibrary();
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingImagePoint = useRef<{ page: EditorPage; point: Point } | null>(null);
  const loadedRef = useRef<LoadedPdf | null>(null);

  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  useEffect(() => () => loadedRef.current?.release(), []);

  const file = files[0]?.file;

  // Open the document as soon as one is chosen.
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
        const pages = initialPages(result.pages);
        doc.reset(pages);
        setActivePageId(pages[0]?.id ?? null);
        setTool(mode === "sign" ? "signature" : "select");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof PdfEditorError
            ? err.message
            : err instanceof Error
              ? err.message
              : "This PDF could not be opened."
        );
        setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // doc.reset is stable; re-running on every doc identity change would reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, mode]);

  // Fit the widest page to the column, and keep it fitted as the window
  // changes size — otherwise a desktop zoom leaves a phone showing a sliver.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || doc.pages.length === 0) return;

    const fit = () => {
      if (userZoomed) return;
      const width = element.clientWidth;
      if (!width) return;
      const widest = Math.max(...doc.pages.map((page) => displaySize(page).width));
      setZoom(Math.max(0.2, Math.min(1.6, (width - 40) / widest)));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [doc.pages, userZoomed]);

  const annotationsByPage = useMemo(() => {
    const map = new Map<string, Annotation[]>();
    for (const annotation of doc.annotations) {
      const list = map.get(annotation.pageId);
      if (list) list.push(annotation);
      else map.set(annotation.pageId, [annotation]);
    }
    return map;
  }, [doc.annotations]);

  const placeSignature = useCallback(
    (page: EditorPage, point: Point, signature: SavedSignature) => {
      const width = Math.min(DEFAULT_SIGNATURE_WIDTH, displaySize(page).width * 0.5);
      const height = width / Math.max(0.2, signature.aspect);
      doc.addAnnotation({
        id: newId("image"),
        pageId: page.id,
        kind: "image",
        x: Math.max(0, point.x - width / 2),
        y: Math.max(0, point.y - height / 2),
        width,
        height,
        data: signature.data,
        mime: signature.mime,
        role: signature.role,
        opacity: 1,
      });
      setTool("select");
    },
    [doc]
  );

  const handleCreateAt = useCallback(
    (page: EditorPage, point: Point) => {
      if (tool === "text" || tool === "date") {
        const id = newId("text");
        const text =
          tool === "date"
            ? new Date().toLocaleDateString(undefined, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : "";
        const width = Math.min(260, displaySize(page).width - point.x - 8);
        doc.addAnnotation({
          id,
          pageId: page.id,
          kind: "text",
          x: point.x,
          y: point.y,
          width: Math.max(80, width),
          height: DEFAULT_TEXT.fontSize * DEFAULT_TEXT.lineHeight * 1.6,
          text,
          fontId: DEFAULT_TEXT.fontId,
          fontSize: DEFAULT_TEXT.fontSize,
          color: DEFAULT_TEXT.color,
          bold: false,
          italic: false,
          align: "left",
          lineHeight: DEFAULT_TEXT.lineHeight,
        });
        setTool("select");
        // Put the caret straight into the new box. Without this the keystrokes
        // land on the document instead, and every space scrolls the page.
        if (tool === "text") setEditingId(id);
        return;
      }

      if (tool === "image") {
        pendingImagePoint.current = { page, point };
        imageInputRef.current?.click();
        return;
      }

      if (tool === "signature" || tool === "initials") {
        const match = signatures.signatures.find((s) => s.role === tool);
        if (!match) {
          pendingImagePoint.current = { page, point };
          setSignatureDialog(tool);
          return;
        }
        placeSignature(page, point, match);
      }
    },
    [doc, placeSignature, signatures.signatures, tool]
  );

  const handleCreateBox = useCallback(
    (page: EditorPage, box: Box, diagonal: "tlbr" | "bltr") => {
      const base = { id: newId(tool), pageId: page.id, ...box };
      if (tool === "highlight") {
        doc.addAnnotation({ ...base, kind: "highlight", color: "#fde047" });
      } else if (tool === "whiteout") {
        doc.addAnnotation({ ...base, kind: "whiteout", color: "#ffffff" });
      } else {
        doc.addAnnotation({
          ...base,
          kind: "shape",
          shape: tool as "rectangle" | "ellipse" | "line" | "arrow",
          stroke: strokeColor,
          strokeWidth,
          fill: undefined,
          opacity: 1,
          diagonal,
        });
      }
      setTool("select");
    },
    [doc, strokeColor, strokeWidth, tool]
  );

  const handleCreateInk = useCallback(
    (page: EditorPage, box: Box, strokes: Point[][]) => {
      doc.addAnnotation({
        id: newId("ink"),
        pageId: page.id,
        ...box,
        kind: "ink",
        strokes,
        stroke: strokeColor,
        strokeWidth,
        opacity: 1,
      });
    },
    [doc, strokeColor, strokeWidth]
  );

  const handleImageChosen = async (chosen: File | undefined) => {
    const target = pendingImagePoint.current;
    pendingImagePoint.current = null;
    if (!chosen || !target) return;
    const raster = await imageFileToPng(chosen);
    if (!raster) {
      toast.error("That image could not be read.");
      return;
    }
    const pageSize = displaySize(target.page);
    const width = Math.min(pageSize.width * 0.5, raster.width * 0.75);
    const height = (raster.height / raster.width) * width;
    doc.addAnnotation({
      id: newId("image"),
      pageId: target.page.id,
      kind: "image",
      x: Math.max(0, target.point.x - width / 2),
      y: Math.max(0, target.point.y - height / 2),
      width,
      height,
      data: raster.data,
      mime: "image/png",
      role: "image",
      opacity: 1,
    });
    setTool("select");
  };

  const handleSignatureCreated = (signature: SavedSignature) => {
    signatures.add(signature);
    const target = pendingImagePoint.current;
    pendingImagePoint.current = null;
    if (target) placeSignature(target.page, target.point, signature);
  };

  // Keyboard: delete the selection, undo/redo, escape back to the select tool.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        setTool("select");
        doc.setSelectedId(null);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && doc.selectedId) {
        event.preventDefault();
        doc.removeAnnotation(doc.selectedId);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) doc.redo();
        else doc.undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doc]);

  const handleExport = async () => {
    if (!loaded) return;
    setExporting(true);
    try {
      const result = await exportEditedPdf({
        source: loaded.bytes,
        pages: doc.pages,
        annotations: doc.annotations,
        sourceGeometry: loaded.pages.map((page) => ({
          width: page.width,
          height: page.height,
          displayToUser: page.displayToUser,
        })),
        fileName: loaded.name,
      });
      saveAs(result.blob, result.filename);
      toast.success(mode === "sign" ? "Signed PDF downloaded." : "Edited PDF downloaded.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The PDF could not be saved.";
      toast.error(message);
      setError(message);
    } finally {
      setExporting(false);
    }
  };

  const startOver = () => {
    loadedRef.current?.release();
    loadedRef.current = null;
    setLoaded(null);
    setFiles([]);
    setError(null);
    setUserZoomed(false);
    doc.reset([]);
  };

  if (!loaded) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <FileUploader
          accept={{ "application/pdf": [".pdf"] }}
          maxFiles={1}
          files={files}
          onFilesChange={setFiles}
        />
        {loading && (
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening your PDF…
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Couldn’t open this file</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {mode === "sign"
            ? "Your document and your signature stay on this device — nothing is uploaded."
            : "Everything happens in your browser. The file never leaves this device."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <EditorToolbar
        mode={mode}
        tool={tool}
        zoom={zoom}
        canUndo={doc.canUndo}
        canRedo={doc.canRedo}
        busy={exporting}
        onToolChange={(next) => {
          setTool(next);
          if (next !== "select") doc.setSelectedId(null);
        }}
        onZoom={(delta) => {
          setUserZoomed(true);
          setZoom((z) => Math.max(0.25, Math.min(3, z + delta)));
        }}
        onUndo={doc.undo}
        onRedo={doc.redo}
        onExport={handleExport}
      />

      <div className="grid gap-3 lg:grid-cols-[190px_minmax(0,1fr)_230px]">
        <aside className="hidden lg:block">
          <PageRail
            proxy={loaded.proxy}
            pages={doc.pages}
            activeId={activePageId}
            showPageActions={mode === "edit"}
            onGoTo={(pageId) => {
              setActivePageId(pageId);
              scrollRef.current
                ?.querySelector(`[data-page-id="${pageId}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onRotate={doc.rotatePage}
            onDelete={doc.removePage}
            onDuplicate={doc.duplicatePage}
            onMove={doc.movePage}
          />
        </aside>

        <div
          ref={scrollRef}
          className="max-h-[75vh] overflow-auto rounded-xl bg-muted/30 p-4"
          onPointerDown={(event) => {
            // Only a click on the empty gutter around the pages ends editing;
            // a click on a page is handled there, and would otherwise cancel
            // the very text box it just created.
            if (event.target === event.currentTarget) setEditingId(null);
          }}
        >
          <div className="flex flex-col items-center gap-6">
            {doc.pages.map((page, index) => (
              <EditorPageView
                key={page.id}
                proxy={loaded.proxy}
                page={page}
                pageNumber={index + 1}
                scale={zoom}
                tool={tool}
                annotations={annotationsByPage.get(page.id) ?? []}
                selectedId={doc.selectedId}
                editingId={editingId}
                strokeColor={strokeColor}
                strokeWidth={strokeWidth}
                onSelect={(id) => {
                  doc.setSelectedId(id);
                  setActivePageId(page.id);
                }}
                onCreateBox={handleCreateBox}
                onCreateAt={(target, point) => {
                  setActivePageId(target.id);
                  handleCreateAt(target, point);
                }}
                onCreateInk={handleCreateInk}
                onUpdate={(id, patch, transient) =>
                  doc.updateAnnotation(id, patch, { transient })
                }
                onStartEdit={setEditingId}
                onChangeText={(id, text) =>
                  doc.updateAnnotation(id, { text }, { transient: true })
                }
                onCommitText={() => setEditingId(null)}
              />
            ))}
          </div>
        </div>

        <aside className="space-y-3">
          {(mode === "sign" || tool === "signature") && (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <p className="text-xs font-medium">Your signatures</p>
              {signatures.signatures.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  None yet. Create one, then click the page to place it.
                </p>
              )}
              <div className="space-y-1.5">
                {signatures.signatures.map((signature) => (
                  <button
                    key={signature.id}
                    type="button"
                    onClick={() => {
                      setTool(signature.role);
                      doc.setSelectedId(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border p-2 hover:bg-muted/50"
                  >
                    <SignaturePreview data={signature.data} className="h-8 w-auto" />
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {signature.label}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 gap-1 text-xs"
                  onClick={() => setSignatureDialog("signature")}
                >
                  <Plus className="h-3.5 w-3.5" /> Signature
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 gap-1 text-xs"
                  onClick={() => setSignatureDialog("initials")}
                >
                  <PenLine className="h-3.5 w-3.5" /> Initials
                </Button>
              </div>
            </div>
          )}

          <PropertiesPanel
            annotation={doc.selected}
            onChange={(patch) => {
              if (!doc.selectedId) return;
              doc.updateAnnotation(doc.selectedId, patch);
              if ("stroke" in patch && typeof patch.stroke === "string") {
                setStrokeColor(patch.stroke);
              }
              if ("strokeWidth" in patch && typeof patch.strokeWidth === "number") {
                setStrokeWidth(patch.strokeWidth);
              }
            }}
            onDelete={() => doc.selectedId && doc.removeAnnotation(doc.selectedId)}
            onDuplicate={() => doc.selectedId && doc.duplicateAnnotation(doc.selectedId)}
            onReorder={(to) => doc.selectedId && doc.reorderAnnotation(doc.selectedId, to)}
          />

          <Separator />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={startOver}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Start over
          </Button>
        </aside>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          void handleImageChosen(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      <SignatureDialog
        open={signatureDialog !== null}
        role={signatureDialog ?? "signature"}
        onOpenChange={(open) => {
          if (!open) {
            setSignatureDialog(null);
            pendingImagePoint.current = null;
          }
        }}
        onCreate={handleSignatureCreated}
      />
    </div>
  );
};

export default PdfEditor;
