import type { AtomicBox, TextLine } from "./types";

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TITLE", "HEAD", "TEMPLATE"]);

function familyOf(fontFamily: string): TextLine["family"] {
  const first = fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "").toLowerCase() ?? "";
  if (/mono|courier|consolas|menlo/.test(fontFamily.toLowerCase())) return "mono";
  if (/^(serif|times|georgia|garamond|cambria|book)/.test(first) || /\bserif\b/.test(fontFamily.toLowerCase().replace(/sans-serif/g, ""))) {
    return "serif";
  }
  return "sans";
}

/** Word boundaries inside a text node, as [start, end) character offsets. */
function wordRanges(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

interface Word {
  text: string;
  rect: DOMRect;
}

/**
 * Group words into line boxes. Two words share a line when their vertical
 * midpoints overlap — robust against superscripts and mixed font sizes, which
 * a plain `top` comparison gets wrong, and it makes no assumption about which
 * direction the script runs.
 */
function groupIntoLines(words: Word[]): Word[][] {
  const lines: Word[][] = [];
  let current: Word[] = [];
  let lineTop = 0;
  let lineBottom = 0;

  for (const word of words) {
    const mid = (word.rect.top + word.rect.bottom) / 2;
    if (current.length > 0 && mid > lineTop && mid < lineBottom) {
      current.push(word);
      lineTop = Math.min(lineTop, word.rect.top);
      lineBottom = Math.max(lineBottom, word.rect.bottom);
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = [word];
    lineTop = word.rect.top;
    lineBottom = word.rect.bottom;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function isRendered(el: Element, view: Window): boolean {
  const style = view.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity || "1") === 0) return false;
  return true;
}

export interface TextLayer {
  lines: TextLine[];
  boxes: AtomicBox[];
  /** Document-space y positions where the author asked for a page break. */
  forcedBreaks: number[];
}

/**
 * Read the laid-out document back as positioned lines of text.
 *
 * Everything is measured in the frame's own coordinates and converted to
 * document space by adding the frame's scroll offset — the frame is grown to
 * fit its content, so that offset is zero, but reading it keeps the maths
 * honest if that ever changes.
 */
export function extractTextLayer(doc: Document): TextLayer {
  const view = doc.defaultView;
  if (!view) return { lines: [], boxes: [], forcedBreaks: [] };

  const originY = view.scrollY;
  const originX = view.scrollX;
  const lines: TextLine[] = [];
  const boxes: AtomicBox[] = [];
  const forcedBreaks: number[] = [];

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (SKIP_TAGS.has((node as Element).tagName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
      return node.textContent && node.textContent.trim().length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const range = doc.createRange();

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const style = view.getComputedStyle(el);
      const before = style.breakBefore || style.pageBreakBefore;
      const after = style.breakAfter || style.pageBreakAfter;
      const rect = el.getBoundingClientRect();
      if (before === "page" || before === "always") forcedBreaks.push(rect.top + originY);
      if (after === "page" || after === "always") forcedBreaks.push(rect.bottom + originY);
      // Replaced content must not be sliced across a page boundary.
      if (/^(IMG|SVG|CANVAS|VIDEO|TABLE)$/.test(el.tagName) && rect.height > 0) {
        boxes.push({ top: rect.top + originY, bottom: rect.bottom + originY });
      }
      continue;
    }

    const text = node.textContent ?? "";
    const parent = node.parentElement;
    if (!parent || !isRendered(parent, view)) continue;

    const style = view.getComputedStyle(parent);
    const fontSize = Number.parseFloat(style.fontSize) || 0;
    if (fontSize <= 0) continue;
    const weight = Number.parseInt(style.fontWeight, 10);
    const line: Omit<TextLine, "words" | "baseline"> = {
      fontSize,
      bold: Number.isFinite(weight) ? weight >= 600 : /bold/.test(style.fontWeight),
      italic: style.fontStyle === "italic" || style.fontStyle === "oblique",
      family: familyOf(style.fontFamily),
    };

    const words: Word[] = [];
    for (const [start, end] of wordRanges(text)) {
      range.setStart(node, start);
      range.setEnd(node, end);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      words.push({ text: text.slice(start, end), rect });
    }
    if (words.length === 0) continue;

    for (const group of groupIntoLines(words)) {
      const top = Math.min(...group.map((w) => w.rect.top));
      const bottom = Math.max(...group.map((w) => w.rect.bottom));
      lines.push({
        ...line,
        words: group.map((w) => ({
          text: w.text,
          x: w.rect.left + originX,
          width: w.rect.width,
        })),
        // A text node's client rect spans the font's ascent and descent; the
        // baseline sits at roughly four fifths of it for the fonts we can
        // substitute in.
        baseline: top + originY + (bottom - top) * 0.79,
      });
      boxes.push({ top: top + originY, bottom: bottom + originY });
    }
  }

  range.detach();
  forcedBreaks.sort((a, b) => a - b);
  return { lines, boxes, forcedBreaks };
}
