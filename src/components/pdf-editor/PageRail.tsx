import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, RotateCw, Trash2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displaySize, renderPageToCanvas } from "@/lib/pdf-editor/document";
import type { EditorPage } from "@/lib/pdf-editor/types";

const THUMB_WIDTH = 34;

/** A real preview of the page, drawn once the rail scrolls it into view. */
function PageThumb({ proxy, page }: { proxy: PDFDocumentProxy; page: EditorPage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const size = displaySize(page);
  const height = Math.max(16, Math.round((size.height / size.width) * THUMB_WIDTH));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setVisible(true)),
      { rootMargin: "300px 0px" }
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !visible) return;
    const handle = renderPageToCanvas(proxy, page, canvas, (THUMB_WIDTH * 2) / size.width);
    return () => handle.cancel();
  }, [page, proxy, size.width, visible]);

  return (
    <canvas
      ref={ref}
      className="shrink-0 rounded-sm bg-muted ring-1 ring-border"
      style={{ width: THUMB_WIDTH, height }}
      aria-hidden
    />
  );
}

type Props = {
  proxy: PDFDocumentProxy;
  pages: EditorPage[];
  activeId: string | null;
  showPageActions: boolean;
  onGoTo: (pageId: string) => void;
  onRotate: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  onDuplicate: (pageId: string) => void;
  onMove: (pageId: string, delta: number) => void;
};

const PageRail = ({
  proxy,
  pages,
  activeId,
  showPageActions,
  onGoTo,
  onRotate,
  onDelete,
  onDuplicate,
  onMove,
}: Props) => (
  <div className="space-y-2">
    <p className="px-1 text-xs font-medium text-muted-foreground">
      {pages.length} page{pages.length === 1 ? "" : "s"}
    </p>
    <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
      {pages.map((page, index) => {
        const active = page.id === activeId;
        return (
          <div key={page.id} className="space-y-1">
            <button
              type="button"
              onClick={() => onGoTo(page.id)}
              aria-current={active}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
              )}
            >
              <PageThumb proxy={proxy} page={page} />
              <span className="text-xs">Page {index + 1}</span>
            </button>

            {showPageActions && (
              <div className="flex gap-0.5 px-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={`Rotate page ${index + 1}`}
                  onClick={() => onRotate(page.id)}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={`Duplicate page ${index + 1}`}
                  onClick={() => onDuplicate(page.id)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={`Move page ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onMove(page.id, -1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label={`Move page ${index + 1} down`}
                  disabled={index === pages.length - 1}
                  onClick={() => onMove(page.id, 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-destructive"
                  aria-label={`Delete page ${index + 1}`}
                  disabled={pages.length === 1}
                  onClick={() => onDelete(page.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);

export default PageRail;
