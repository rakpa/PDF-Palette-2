import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyRedactions, type RedactionBox } from "./pdf-redact/redact";
import { ocrPdf, OcrError } from "./pdf-ocr/ocr";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Hit in PDF user space (origin bottom-left), converted to top-left boxes later. */
type Hit = { page: number; x: number; y: number; w: number; h: number; kind: string; pageHeight: number };

/** Section headers / labels that must not be treated as a person name. */
const NOT_A_NAME = new Set(
  [
    "experience",
    "education",
    "skills",
    "summary",
    "profile",
    "objective",
    "contact",
    "projects",
    "certifications",
    "references",
    "interests",
    "languages",
    "employment",
    "work experience",
    "professional experience",
    "about",
    "about me",
    "personal details",
    "personal information",
    "curriculum vitae",
    "resume",
    "cv",
    "declaration",
    "achievements",
    "awards",
    "publications",
    "technical skills",
    "soft skills",
    "work history",
    "career objective",
    "contact information",
    "contact details",
    "phone",
    "email",
    "mobile",
    "address",
    "location",
    "linkedin",
    "github",
  ].map((s) => s.toLowerCase())
);

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

/** Phones: +91 98765 43210, (555) 987-6543, 555.987.6543, 9876543210, etc. */
const PHONE_RE =
  /(?:(?:\+|00)\d{1,3}[\s.-]*)?(?:\(?\d{2,4}\)?[\s.-]*)?\d{3,5}[\s.-]*\d{3,5}(?:[\s.-]*\d{2,5})?\b/g;

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const URL_PII_RE =
  /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/|github\.com\/)[A-Za-z0-9._/-]+\b/gi;
const DOB_RE =
  /\b(?:(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19|20)\d{2}|(?:19|20)\d{2}[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01]))\b/g;

const LABEL_VALUE_RE =
  /\b(full\s*name|candidate\s*name|name|phone|mobile|tel|telephone|cell|email|e-?mail|address|location|reside(?:nce)?|current\s*address|permanent\s*address|home\s*address|mailing\s*address|dob|date\s*of\s*birth|father'?s\s*name|mother'?s\s*name)\s*[:\-–=|]\s*([^\n|;]+)/gi;

const STREET_WORD_RE =
  /\b(?:road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|boulevard|blvd\.?|drive|dr\.?|nagar|colony|society|apartment|apartments|apt\.?|sector|block|plot|flat|floor|cross|layout|village|district|township|phase|plaza|tower|residency|enclave|park|hill|villa|house|near|opp\.?|opposite)\b/i;

const PIN_RE = /\b(?:PIN(?:code)?|Zip(?:code)?)\s*[:\-]?\s*\d{4,6}\b|\b\d{6}\b|\b\d{5}(?:-\d{4})?\b/i;

function isLikelyAddress(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 140) return false;
  if (NOT_A_NAME.has(text.toLowerCase())) return false;
  if (/@/.test(text)) return false;
  if (/^https?:/i.test(text)) return false;
  // Don't treat pure phone lines as addresses.
  if (isLikelyPhone(text) && !STREET_WORD_RE.test(text)) return false;

  const hasDigit = /\d/.test(text);
  const hasStreet = STREET_WORD_RE.test(text);
  const hasPin = PIN_RE.test(text);
  const hasCommaPlace = /,\s*[A-Za-z][A-Za-z .'-]{2,}/.test(text);
  const labeled =
    /^(?:address|location|residence|current address|permanent address|home address)\b/i.test(text);

  if (labeled && text.length > 12) return true;
  if (hasStreet && (hasDigit || hasCommaPlace)) return true;
  if (hasPin && (hasStreet || hasCommaPlace || hasDigit)) return true;
  if (hasDigit && hasCommaPlace && /[A-Za-z]{3,}/.test(text)) return true;
  return false;
}

function isAddressContinuation(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 100) return false;
  if (NOT_A_NAME.has(text.toLowerCase())) return false;
  if (/^(experience|education|skills|summary|projects|work|objective)\b/i.test(text)) return false;
  if (/@/.test(text)) return false;
  return (
    STREET_WORD_RE.test(text) ||
    PIN_RE.test(text) ||
    /,\s*[A-Za-z]/.test(text) ||
    /\b(?:India|USA|UK|UAE|Canada|Australia|Maharashtra|Karnataka|Delhi|Mumbai|Pune|Bengaluru|Bangalore|Hyderabad|Chennai|Kolkata|California|Texas|New York)\b/i.test(
      text
    )
  );
}

function isLikelyPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  // Avoid years / zip-like short runs already filtered by length.
  if (/^(19|20)\d{2}$/.test(digits)) return false;
  return true;
}

function isLikelyCard(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19;
}

function isPersonName(raw: string): boolean {
  let text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 70) return false;
  if (NOT_A_NAME.has(text.toLowerCase())) return false;
  if (/\d/.test(text) || /@/.test(text)) return false;
  if (/https?:/i.test(text)) return false;
  if (/[|/•·]/.test(text)) return false;
  // Drop common resume prefixes: Dr. / Mr. / Ms. / Mrs. / Prof.
  text = text.replace(/^(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor)\.?\s+/i, "").trim();
  // "Ada Lovelace", "JOHN DOE", "Mary-Jane Watson", "Ada Lovelace, PMP"
  text = text.replace(/,\s*(?:PMP|MBA|PhD|CPA|Esq\.?)$/i, "").trim();
  if (
    /engineer|manager|developer|designer|analyst|consultant|student|intern|director|officer|executive|specialist|architect|founder|ceo|cto|lead|senior|junior|associate/i.test(
      text
    )
  ) {
    return false;
  }
  // Allow a single middle initial: "Jane M Doe"
  if (
    /^[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z](?:\.|[a-z]+(?:[-'][A-Z][a-z]+)*)?){1,3}$/.test(
      text
    )
  ) {
    return true;
  }
  if (/^[A-Z]{2,}(?:\s+[A-Z](?:\.|[A-Z]{1,})?){1,3}$/.test(text)) return true;
  // Lowercase / mixed CV names: "amit kumar", "Priya sharma"
  if (/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){1,3}$/.test(text)) return true;
  return false;
}

/** Labels that often sit alone on a line with the value on the next line. */
const SOLO_LABEL_RE =
  /^(?:full\s*name|candidate\s*name|name|phone|mobile|tel|telephone|cell|email|e-?mail|address|location|residence|current\s*address|permanent\s*address|home\s*address|mailing\s*address|dob|date\s*of\s*birth|linkedin|github)\s*:?\s*$/i;

function isSoloLabel(text: string): boolean {
  return SOLO_LABEL_RE.test(text.replace(/\s+/g, " ").trim());
}

function groupIntoLines(items: TextItem[]): TextItem[][] {
  if (!items || items.length === 0) return [];
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    let line = lines.find(
      (group) => Math.abs(group[0].y - item.y) <= Math.max(3.5, group[0].height * 0.45)
    );
    if (line) line.push(item);
    else lines.push([item]);
  }
  for (let i = 0; i < lines.length; i++) lines[i].sort((a, b) => a.x - b.x);
  return lines;
}

type MappedLine = {
  text: string;
  /** For each character index, the source item (or null for inserted spaces). */
  map: Array<TextItem | null>;
  y: number;
  height: number;
  pageTop: number;
};

function buildMappedLine(items: TextItem[]): MappedLine {
  let text = "";
  const map: Array<TextItem | null> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i > 0) {
      const prev = items[i - 1];
      const gap = item.x - (prev.x + prev.width);
      // Insert a space when glyphs are visually separated. Keep single-character
      // runs tight so emails/phones split across spans still match.
      const singleRun = prev.str.length <= 1 && item.str.length <= 1;
      const gapLimit = singleRun
        ? Math.max(2.5, prev.height * 0.35)
        : Math.max(1.2, prev.height * 0.12);
      if (gap > gapLimit && !text.endsWith(" ") && !item.str.startsWith(" ")) {
        text += " ";
        map.push(null);
      }
    }
    for (let c = 0; c < item.str.length; c++) {
      text += item.str[c];
      map.push(item);
    }
  }
  const height = Math.max(...items.map((it) => it.height), 10);
  const y = items.reduce((s, it) => s + it.y, 0) / items.length;
  return { text, map, y, height, pageTop: 0 };
}

function boxesForRange(
  line: MappedLine,
  start: number,
  end: number,
  page: number,
  kind: string,
  pageHeight: number
): Hit[] {
  const hits: Hit[] = [];
  let i = Math.max(0, start);
  while (i < end && i < line.map.length) {
    const item = line.map[i];
    if (!item) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < end && line.map[j] === item) j += 1;
    const localStart = (() => {
      // Offset of i within this item's characters in the map.
      let offset = 0;
      for (let k = i - 1; k >= 0 && line.map[k] === item; k--) offset += 1;
      return offset;
    })();
    const localLen = j - i;
    const unit = item.str.length ? item.width / item.str.length : item.height * 0.5;
    const x = item.x + localStart * unit;
    const w = Math.max(unit * localLen, item.height * 0.6);
    const padX = 1.5;
    const padY = item.height * 0.2;
    hits.push({
      page,
      x: x - padX,
      y: item.y - padY,
      w: w + padX * 2,
      h: item.height + padY * 2,
      kind,
      pageHeight,
    });
    i = j;
  }
  return hits;
}

function addRegexHits(
  line: MappedLine,
  page: number,
  pageHeight: number,
  re: RegExp,
  kind: string,
  validate?: (m: string) => boolean
): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  const source = line.text || "";
  while ((match = re.exec(source))) {
    const value = match[0];
    if (validate && !validate(value)) continue;
    const range = boxesForRange(line, match.index, match.index + value.length, page, kind, pageHeight);
    for (let i = 0; i < range.length; i++) hits.push(range[i]);
  }
  return hits;
}

/**
 * Match emails even when pdf.js inserted spaces between glyphs
 * ("j a n e @ x . c o m") by searching a whitespace-collapsed copy.
 */
function addCollapsedEmailHits(line: MappedLine, page: number, pageHeight: number): Hit[] {
  const original = line.text || "";
  let collapsed = "";
  const toOrig: number[] = [];
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (/\s/.test(ch) || ch === "\u200b" || ch === "\ufeff" || ch === "\u00ad") continue;
    toOrig.push(i);
    collapsed += ch;
  }
  if (!collapsed.includes("@")) return [];
  const hits: Hit[] = [];
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(collapsed))) {
    const from = toOrig[match.index];
    const last = toOrig[match.index + match[0].length - 1];
    if (from == null || last == null) continue;
    const range = boxesForRange(line, from, last + 1, page, "email", pageHeight);
    for (let i = 0; i < range.length; i++) hits.push(range[i]);
  }
  return hits;
}

/** Digits-only phone hunt for numbers broken by spaces/glyphs. */
function addCollapsedPhoneHits(line: MappedLine, page: number, pageHeight: number): Hit[] {
  const original = line.text || "";
  let collapsed = "";
  const toOrig: number[] = [];
  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (/\s/.test(ch) || ch === "\u200b" || ch === "\ufeff") continue;
    toOrig.push(i);
    collapsed += ch;
  }
  const hits: Hit[] = [];
  const re = /(?:\+|00)?\d[\d().-]{8,18}\d/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(collapsed))) {
    if (!isLikelyPhone(match[0])) continue;
    const from = toOrig[match.index];
    const last = toOrig[match.index + match[0].length - 1];
    if (from == null || last == null) continue;
    const range = boxesForRange(line, from, last + 1, page, "phone", pageHeight);
    for (let i = 0; i < range.length; i++) hits.push(range[i]);
  }
  return hits;
}

function collectPageItems(content: { items?: unknown[] } | null | undefined): TextItem[] {
  const out: TextItem[] = [];
  const rawItems = content?.items;
  const items = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof (rawItems as Iterable<unknown>)[Symbol.iterator] === "function"
      ? Array.from(rawItems as Iterable<unknown>)
      : [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as {
      str: string;
      transform?: number[];
      width?: number;
      height?: number;
    };
    if (!item.str || !item.str.trim()) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
    const height = Math.abs(transform[3] || transform[0] || item.height || 10);
    const width =
      typeof item.width === "number" && item.width > 0
        ? item.width
        : Math.max(height * 0.5 * item.str.length, height);
    out.push({
      str: item.str,
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width,
      height,
    });
  }
  return out;
}

function hitsToRedactionBoxes(hits: Hit[]): RedactionBox[] {
  const boxes: RedactionBox[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    // pdf-lib / PDF user space → top-left display space used by applyRedactions.
    boxes.push({
      page: hit.page,
      x: hit.x,
      y: hit.pageHeight - hit.y - hit.h,
      width: Math.max(hit.w, 4),
      height: Math.max(hit.h, 4),
    });
  }
  return boxes;
}

function normalizeKind(kind: string): string {
  const raw = String(kind || "");
  if (raw.startsWith("label-")) {
    const rest = raw.slice(6);
    if (/name/.test(rest)) return "name";
    if (/phone|mobile|tel|cell/.test(rest)) return "phone";
    if (/email/.test(rest)) return "email";
    if (/address|location|reside/.test(rest)) return "address";
    if (/dob|birth/.test(rest)) return "dob";
    return "label";
  }
  if (raw === "profile-url") return "profile";
  return raw.split("-")[0] || raw;
}

function uniqueKinds(hits: Hit[]): string[] {
  const kinds: string[] = [];
  const seen: Record<string, 1> = Object.create(null);
  for (let i = 0; i < hits.length; i++) {
    const kind = normalizeKind(hits[i].kind);
    if (!kind || seen[kind]) continue;
    seen[kind] = 1;
    kinds.push(kind);
  }
  return kinds;
}

/**
 * Find CV / personal-data patterns across reconstructed text lines (so phones
 * split across spans still match), then rebuild affected pages as pictures
 * with the matches painted out.
 *
 * Scanned / image-only PDFs have no text layer — when that happens we OCR in
 * the browser first, then scan again, so the user does not need a separate
 * OCR step.
 */
async function scanPiiHits(
  data: Uint8Array,
  onProgress?: (progress: number, message?: string) => void,
  progressFrom = 8,
  progressTo = 48
): Promise<{ hits: Hit[]; totalChars: number }> {
  const task = pdfjsLib.getDocument({
    data: data.slice(),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  let src;
  try {
    src = await task.promise;
  } catch {
    void task.destroy().catch(() => undefined);
    throw new Error("This file could not be read as a PDF.");
  }

  const hits: Hit[] = [];
  let totalChars = 0;
  try {
    const total = src.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await src.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;
      let content: { items?: unknown[] } = { items: [] };
      try {
        content = await page.getTextContent();
      } catch (error) {
        console.warn(`auto-redact: text layer unavailable on page ${n}`, error);
      }
      const items = collectPageItems(content);
      for (let ii = 0; ii < items.length; ii++) {
        totalChars += items[ii].str.replace(/\s/g, "").length;
      }
      const lineGroups = groupIntoLines(items);
      const lines: MappedLine[] = [];
      for (let g = 0; g < lineGroups.length; g++) {
        const mapped = buildMappedLine(lineGroups[g]);
        mapped.pageTop = pageHeight;
        lines.push(mapped);
      }

      const sizes = items.map((it) => it.height).sort((a, b) => a - b);
      const medianSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        const pushHits = (more: Hit[]) => {
          for (let i = 0; i < more.length; i++) hits.push(more[i]);
        };
        pushHits(addRegexHits(line, n, pageHeight, EMAIL_RE, "email"));
        pushHits(addCollapsedEmailHits(line, n, pageHeight));
        pushHits(addRegexHits(line, n, pageHeight, PHONE_RE, "phone", isLikelyPhone));
        pushHits(addCollapsedPhoneHits(line, n, pageHeight));
        pushHits(addRegexHits(line, n, pageHeight, SSN_RE, "ssn"));
        pushHits(addRegexHits(line, n, pageHeight, CARD_RE, "card", isLikelyCard));
        pushHits(addRegexHits(line, n, pageHeight, URL_PII_RE, "profile-url"));
        pushHits(addRegexHits(line, n, pageHeight, DOB_RE, "dob"));

        LABEL_VALUE_RE.lastIndex = 0;
        let labelMatch: RegExpExecArray | null;
        let redactedAddressLabel = false;
        while ((labelMatch = LABEL_VALUE_RE.exec(line.text || ""))) {
          const label = labelMatch[1].toLowerCase();
          const value = labelMatch[2].trim();
          if (!value) continue;
          const valueStart = labelMatch.index + labelMatch[0].length - labelMatch[2].length;
          if (/name|phone|mobile|tel|cell|email|address|location|reside|dob|birth/.test(label)) {
            pushHits(boxesForRange(line, valueStart, valueStart + value.length, n, `label-${label}`, pageHeight));
            if (/address|location|reside/.test(label)) redactedAddressLabel = true;
          }
        }

        const trimmed = (line.text || "").trim();

        if (isSoloLabel(trimmed)) {
          const labelKind = trimmed.replace(/:$/, "").toLowerCase();
          for (let k = 1; k <= 2; k++) {
            const next = lines[li + k];
            if (!next) break;
            const gap = line.y - next.y;
            if (gap < 0 || gap > Math.max(40, line.height * 3)) break;
            const nextText = (next.text || "").trim();
            if (!nextText || isSoloLabel(nextText) || NOT_A_NAME.has(nextText.toLowerCase())) break;
            if (/^(experience|education|skills|summary|projects|objective|work)\b/i.test(nextText)) break;
            pushHits(boxesForRange(next, 0, next.text.length, n, `label-${labelKind}`, pageHeight));
            if (/address|location|reside/.test(labelKind)) redactedAddressLabel = true;
            if (!/address|location|reside/.test(labelKind)) break;
          }
        }

        if (isLikelyAddress(trimmed)) {
          pushHits(boxesForRange(line, 0, line.text.length, n, "address", pageHeight));
          redactedAddressLabel = true;
        }

        if (/[|/•·]/.test(trimmed) && (/@/.test(trimmed) || /\d{8,}/.test(trimmed))) {
          const parts = trimmed.split(/\s*[|/•·]\s*/);
          let cursor = 0;
          for (let pi = 0; pi < parts.length; pi++) {
            const part = parts[pi];
            const at = trimmed.indexOf(part, cursor);
            if (at < 0) continue;
            cursor = at + part.length;
            if (!part || /@/.test(part) || isLikelyPhone(part)) continue;
            if (/^[A-Za-z][A-Za-z .'-]{2,40}$/.test(part) && !NOT_A_NAME.has(part.toLowerCase())) {
              pushHits(boxesForRange(line, at, at + part.length, n, "address", pageHeight));
            }
          }
        }

        if (redactedAddressLabel) {
          for (let k = 1; k <= 2; k++) {
            const next = lines[li + k];
            if (!next) break;
            const gap = line.y - next.y;
            if (gap < 0 || gap > Math.max(36, line.height * 2.8)) break;
            const nextText = (next.text || "").trim();
            if (!nextText || NOT_A_NAME.has(nextText.toLowerCase())) break;
            if (/^(experience|education|skills|summary|projects|objective|work)\b/i.test(nextText)) break;
            if (isAddressContinuation(nextText) || isLikelyAddress(nextText)) {
              pushHits(boxesForRange(next, 0, next.text.length, n, "address", pageHeight));
            } else {
              break;
            }
          }
        }

        if (n === 1) {
          const fromTop = pageHeight - line.y;
          const nearTop = fromTop < pageHeight * 0.4;
          const large = line.height >= medianSize * 1.15 || line.height >= 12;
          if (nearTop && (large || line.height >= medianSize * 0.9) && isPersonName(trimmed)) {
            pushHits(boxesForRange(line, 0, line.text.length, n, "name", pageHeight));
          }
        }
      }

      page.cleanup();
      const span = progressTo - progressFrom;
      onProgress?.(
        progressFrom + Math.round((n / total) * span),
        `Scanning page ${n} of ${total}…`
      );
    }
  } finally {
    try {
      src.cleanup?.();
    } catch {
      /* ignore */
    }
    void task.destroy().catch(() => undefined);
  }

  return { hits, totalChars };
}

function dedupeHits(hits: Hit[]): Hit[] {
  const unique: Hit[] = [];
  for (let hi = 0; hi < hits.length; hi++) {
    const hit = hits[hi];
    let dup = false;
    for (let ui = 0; ui < unique.length; ui++) {
      const u = unique[ui];
      if (
        u.page === hit.page &&
        Math.abs(u.x - hit.x) < 1.5 &&
        Math.abs(u.y - hit.y) < 1.5 &&
        Math.abs(u.w - hit.w) < 2
      ) {
        dup = true;
        break;
      }
    }
    if (!dup) unique.push(hit);
  }
  return unique;
}

export async function autoRedactPiiLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string; redactionCount: number; kinds: string[] }> {
  onProgress?.(4, "Opening PDF…");
  let data = new Uint8Array(await file.arrayBuffer());

  let { hits, totalChars } = await scanPiiHits(data, onProgress, 6, 28);

  // Image-only / scanned PDFs: recognise text in the browser, then scan again.
  if (totalChars < 8) {
    onProgress?.(30, "No text layer — running OCR…");
    try {
      const ocr = await ocrPdf(file, (p, message) =>
        onProgress?.(30 + Math.round(Math.min(100, Math.max(0, p)) * 0.28), message || "Recognising…")
      );
      if (ocr.words < 1 && ocr.ocrPages < 1) {
        throw new Error(
          "OCR could not read any text from this PDF. Try a clearer scan, or run OCR PDF first."
        );
      }
      data = new Uint8Array(await ocr.blob.arrayBuffer());
      ({ hits, totalChars } = await scanPiiHits(data, onProgress, 60, 72));
    } catch (error) {
      if (error instanceof OcrError) throw new Error(error.message);
      const message = error instanceof Error ? error.message : "";
      if (/OCR could not read|clearer scan/i.test(message)) throw error instanceof Error ? error : new Error(message);
      throw new Error(
        message ||
          "This PDF has no selectable text and OCR failed. Try OCR PDF first, then Auto-Redact."
      );
    }
  }

  const unique = dedupeHits(hits);

  if (unique.length === 0) {
    if (totalChars < 8) {
      throw new Error(
        "OCR could not read any text from this PDF. Try a clearer scan, or run OCR PDF first."
      );
    }
    throw new Error(
      "No personal data patterns were found (name, email, phone, address, LinkedIn/GitHub, DOB, SSN, or card)."
    );
  }

  onProgress?.(75, "Applying redactions...");
  const boxes = hitsToRedactionBoxes(unique);
  let saved: Uint8Array;
  try {
    saved = await applyRedactions(
      data,
      boxes,
      [],
      { mode: "color", color: "#000000" },
      (p, message) => onProgress?.(75 + Math.round(p * 0.22), message)
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new Error(message || "Could not apply rededations to this PDF.");
  }

  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  const kinds = uniqueKinds(unique);
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}-redacted.pdf`,
    redactionCount: unique.length,
    kinds,
  };
}
