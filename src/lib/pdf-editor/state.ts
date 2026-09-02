import { useCallback, useMemo, useRef, useState } from "react";
import {
  clampBox,
  rotateBoxClockwise,
  rotatePointsClockwise,
} from "./geometry";
import { displaySize } from "./document";
import type {
  Annotation,
  Box,
  EditorPage,
  FontId,
  SavedSignature,
} from "./types";

export type EditorSnapshot = {
  pages: EditorPage[];
  annotations: Annotation[];
};

const HISTORY_LIMIT = 60;

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The editor's document state, with undo/redo.
 *
 * Pages and annotations move together through history, so undoing a page
 * deletion brings back whatever was placed on it.
 */
export function useEditorDocument() {
  const [snapshot, setSnapshot] = useState<EditorSnapshot>({ pages: [], annotations: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const past = useRef<EditorSnapshot[]>([]);
  const future = useRef<EditorSnapshot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  const reset = useCallback((pages: EditorPage[]) => {
    past.current = [];
    future.current = [];
    setSnapshot({ pages, annotations: [] });
    setSelectedId(null);
    setHistoryVersion((v) => v + 1);
  }, []);

  /** Apply a change and push the previous state onto the undo stack. */
  const commit = useCallback((change: (current: EditorSnapshot) => EditorSnapshot) => {
    setSnapshot((current) => {
      const next = change(current);
      if (next === current) return current;
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), current];
      future.current = [];
      return next;
    });
    setHistoryVersion((v) => v + 1);
  }, []);

  /**
   * Apply a change without touching history — used while a drag is in flight,
   * so a single drag produces one undo step rather than one per mouse move.
   */
  const amend = useCallback((change: (current: EditorSnapshot) => EditorSnapshot) => {
    setSnapshot((current) => change(current));
  }, []);

  const undo = useCallback(() => {
    setSnapshot((current) => {
      const previous = past.current.pop();
      if (!previous) return current;
      future.current = [...future.current, current];
      return previous;
    });
    setSelectedId(null);
    setHistoryVersion((v) => v + 1);
  }, []);

  const redo = useCallback(() => {
    setSnapshot((current) => {
      const next = future.current.pop();
      if (!next) return current;
      past.current = [...past.current, current];
      return next;
    });
    setSelectedId(null);
    setHistoryVersion((v) => v + 1);
  }, []);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;

  const addAnnotation = useCallback(
    (annotation: Annotation) => {
      commit((current) => ({ ...current, annotations: [...current.annotations, annotation] }));
      setSelectedId(annotation.id);
    },
    [commit]
  );

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>, options?: { transient?: boolean }) => {
      const apply = (current: EditorSnapshot): EditorSnapshot => ({
        ...current,
        annotations: current.annotations.map((a) =>
          a.id === id ? ({ ...a, ...patch } as Annotation) : a
        ),
      });
      if (options?.transient) amend(apply);
      else commit(apply);
    },
    [amend, commit]
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      commit((current) => ({
        ...current,
        annotations: current.annotations.filter((a) => a.id !== id),
      }));
      setSelectedId((selected) => (selected === id ? null : selected));
    },
    [commit]
  );

  const duplicateAnnotation = useCallback(
    (id: string) => {
      let created: string | null = null;
      commit((current) => {
        const source = current.annotations.find((a) => a.id === id);
        if (!source) return current;
        created = newId(source.kind);
        const copy = { ...source, id: created, x: source.x + 12, y: source.y + 12 } as Annotation;
        return { ...current, annotations: [...current.annotations, copy] };
      });
      if (created) setSelectedId(created);
    },
    [commit]
  );

  /** Move an annotation to the front or back of its page's stack. */
  const reorderAnnotation = useCallback(
    (id: string, to: "front" | "back") => {
      commit((current) => {
        const target = current.annotations.find((a) => a.id === id);
        if (!target) return current;
        const rest = current.annotations.filter((a) => a.id !== id);
        return {
          ...current,
          annotations: to === "front" ? [...rest, target] : [target, ...rest],
        };
      });
    },
    [commit]
  );

  const rotatePage = useCallback(
    (pageId: string) => {
      commit((current) => {
        const page = current.pages.find((p) => p.id === pageId);
        if (!page) return current;
        const size = displaySize(page);
        return {
          pages: current.pages.map((p) =>
            p.id === pageId
              ? { ...p, rotation: (((p.rotation + 90) % 360) as EditorPage["rotation"]) }
              : p
          ),
          // Whatever is on the page turns with it.
          annotations: current.annotations.map((a) => {
            if (a.pageId !== pageId) return a;
            const box = rotateBoxClockwise(a, size.height);
            if (a.kind === "ink") {
              return { ...a, ...box, strokes: a.strokes.map(rotatePointsClockwise) };
            }
            return { ...a, ...box } as Annotation;
          }),
        };
      });
    },
    [commit]
  );

  const removePage = useCallback(
    (pageId: string) => {
      commit((current) => {
        if (current.pages.length <= 1) return current;
        return {
          pages: current.pages.filter((p) => p.id !== pageId),
          annotations: current.annotations.filter((a) => a.pageId !== pageId),
        };
      });
    },
    [commit]
  );

  const duplicatePage = useCallback(
    (pageId: string) => {
      commit((current) => {
        const index = current.pages.findIndex((p) => p.id === pageId);
        if (index < 0) return current;
        const source = current.pages[index];
        const copy: EditorPage = { ...source, id: newId("page") };
        const pages = [...current.pages];
        pages.splice(index + 1, 0, copy);
        const cloned = current.annotations
          .filter((a) => a.pageId === pageId)
          .map((a) => ({ ...a, id: newId(a.kind), pageId: copy.id }) as Annotation);
        return { pages, annotations: [...current.annotations, ...cloned] };
      });
    },
    [commit]
  );

  const movePage = useCallback(
    (pageId: string, delta: number) => {
      commit((current) => {
        const index = current.pages.findIndex((p) => p.id === pageId);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= current.pages.length) return current;
        const pages = [...current.pages];
        const [moved] = pages.splice(index, 1);
        pages.splice(target, 0, moved);
        return { ...current, pages };
      });
    },
    [commit]
  );

  const selected = useMemo(
    () => snapshot.annotations.find((a) => a.id === selectedId) ?? null,
    [snapshot.annotations, selectedId]
  );

  return {
    pages: snapshot.pages,
    annotations: snapshot.annotations,
    selected,
    selectedId,
    setSelectedId,
    reset,
    commit,
    amend,
    undo,
    redo,
    canUndo,
    canRedo,
    historyVersion,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    duplicateAnnotation,
    reorderAnnotation,
    rotatePage,
    removePage,
    duplicatePage,
    movePage,
  };
}

export type EditorDocument = ReturnType<typeof useEditorDocument>;

/** Keeps signatures for the session only — never written to disk. */
export function useSignatureLibrary() {
  const [signatures, setSignatures] = useState<SavedSignature[]>([]);

  const add = useCallback((signature: SavedSignature) => {
    setSignatures((current) => [...current, signature]);
  }, []);

  const remove = useCallback((id: string) => {
    setSignatures((current) => current.filter((s) => s.id !== id));
  }, []);

  return { signatures, add, remove };
}

export const DEFAULT_TEXT = {
  fontId: "helvetica" as FontId,
  fontSize: 14,
  color: "#111111",
  lineHeight: 1.25,
};

export function fitBox(box: Box, page: { width: number; height: number }): Box {
  return clampBox(box, page.width, page.height);
}
