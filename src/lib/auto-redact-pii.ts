import { PDFDocument, rgb } from "pdf-lib";
import "./promise-with-resolvers-polyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Hit = { page: number; x: number; y: number; w: number; h: number; kind: string };

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
  /\b(full\s*name|candidate\s*name|name|phone|mobile|tel|telephone|cell|email|e-?mail|address|location|dob|date\s*of\s*birth|father'?s\s*name|mother'?s\s*name)\s*[:\-–]\s*([^\n|;]+)/gi;

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
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 60) return false;
  if (NOT_A_NAME.has(text.toLowerCase())) return false;
  if (/\d/.test(text) || /@/.test(text)) return false;
  if (/https?:/i.test(text)) return false;
  // "Ada Lovelace", "JOHN DOE", "Mary-Jane Watson"
  if (/^[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*(?:\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)*){1,3}$/.test(text)) {
    return true;
  }
  if (/^[A-Z]{2,}(?:\s+[A-Z]{2,}){1,3}$/.test(text)) return true;
  return false;
}

function groupIntoLines(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const line = lines.find(
      (group) => Math.abs(group[0].y - item.y) <= Math.max(3.5, group[0].height * 0.45)
    );
    if (line) line.push(item);
    else lines.push([item]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
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
      // Insert a space when glyphs are visually separated.
      if (gap > Math.max(1.2, prev.height * 0.12) && !text.endsWith(" ") && !item.str.startsWith(" ")) {
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

function boxesForRange(line: MappedLine, start: number, end: number, page: number, kind: string): Hit[] {
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
    });
    i = j;
  }
  return hits;
}

function addRegexHits(line: MappedLine, page: number, re: RegExp, kind: string, validate?: (m: string) => boolean): Hit[] {
  const hits: Hit[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  const source = line.text;
  while ((match = re.exec(source))) {
    const value = match[0];
    if (validate && !validate(value)) continue;
    hits.push(...boxesForRange(line, match.index, match.index + value.length, page, kind));
  }
  return hits;
}

function collectPageItems(content: { items: unknown[] }): TextItem[] {
  const out: TextItem[] = [];
  for (const raw of content.items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as {
      str: string;
      transform: number[];
      width?: number;
      height?: number;
    };
    if (!item.str || !item.str.trim()) continue;
    const transform = item.transform;
    const height = Math.abs(transform[3] || transform[0] || item.height || 10);
    const width =
      typeof item.width === "number" && item.width > 0
        ? item.width
        : Math.max(height * 0.5 * item.str.length, height);
    out.push({
      str: item.str,
      x: transform[4],
      y: transform[5],
      width,
      height,
    });
  }
  return out;
}

/**
 * Find CV / personal-data patterns across reconstructed text lines (so phones
 * split across spans still match), black them out, then flatten.
 */
export async function autoRedactPiiLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string; redactionCount: number; kinds: string[] }> {
  onProgress?.(5, "Opening PDF…");
  const data = new Uint8Array(await file.arrayBuffer());
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
  try {
    const total = src.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await src.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;
      const content = await page.getTextContent();
      const items = collectPageItems(content);
      const lines = groupIntoLines(items).map((group) => {
        const mapped = buildMappedLine(group);
        mapped.pageTop = pageHeight;
        return mapped;
      });

      const sizes = items.map((it) => it.height).sort((a, b) => a - b);
      const medianSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 12;

      for (const line of lines) {
        hits.push(...addRegexHits(line, n, EMAIL_RE, "email"));
        hits.push(...addRegexHits(line, n, PHONE_RE, "phone", isLikelyPhone));
        hits.push(...addRegexHits(line, n, SSN_RE, "ssn"));
        hits.push(...addRegexHits(line, n, CARD_RE, "card", isLikelyCard));
        hits.push(...addRegexHits(line, n, URL_PII_RE, "profile-url"));
        hits.push(...addRegexHits(line, n, DOB_RE, "dob"));

        // Labeled fields: "Phone: 98765..." / "Name: Ada Lovelace"
        LABEL_VALUE_RE.lastIndex = 0;
        let labelMatch: RegExpExecArray | null;
        while ((labelMatch = LABEL_VALUE_RE.exec(line.text))) {
          const label = labelMatch[1].toLowerCase();
          const value = labelMatch[2].trim();
          if (!value) continue;
          const valueStart = labelMatch.index + labelMatch[0].length - labelMatch[2].length;
          // For name labels, redact the value; for phone/email also (pattern may have caught it).
          if (/name/.test(label) || /phone|mobile|tel|cell|email|address|location|dob|birth/.test(label)) {
            const end = valueStart + value.length;
            hits.push(...boxesForRange(line, valueStart, end, n, `label-${label}`));
          }
        }

        // CV name heuristic: large title-like text in the top band of page 1.
        if (n === 1) {
          const fromTop = pageHeight - line.y;
          const nearTop = fromTop < pageHeight * 0.28;
          const large = line.height >= medianSize * 1.25 || line.height >= 14;
          const trimmed = line.text.trim();
          if (nearTop && large && isPersonName(trimmed)) {
            hits.push(...boxesForRange(line, 0, line.text.length, n, "name"));
          } else if (nearTop && isPersonName(trimmed) && line.height >= medianSize) {
            hits.push(...boxesForRange(line, 0, line.text.length, n, "name"));
          }
        }
      }

      page.cleanup();
      onProgress?.(8 + Math.round((n / total) * 40), `Scanning page ${n} of ${total}…`);
    }
  } finally {
    try {
      src.cleanup?.();
    } catch {
      /* ignore */
    }
    void task.destroy().catch(() => undefined);
  }

  // Deduplicate nearly-identical boxes.
  const unique: Hit[] = [];
  for (const hit of hits) {
    const dup = unique.some(
      (u) =>
        u.page === hit.page &&
        Math.abs(u.x - hit.x) < 1.5 &&
        Math.abs(u.y - hit.y) < 1.5 &&
        Math.abs(u.w - hit.w) < 2
    );
    if (!dup) unique.push(hit);
  }

  if (unique.length === 0) {
    throw new Error(
      "No personal data patterns were found (name, email, phone, address labels, LinkedIn/GitHub, DOB, SSN, or card)."
    );
  }

  onProgress?.(55, "Applying redactions…");
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(data);
  } catch {
    throw new Error("This file could not be read as a PDF.");
  }

  const pages = pdf.getPages();
  for (const hit of unique) {
    const page = pages[hit.page - 1];
    if (!page) continue;
    page.drawRectangle({
      x: hit.x,
      y: hit.y,
      width: Math.max(hit.w, 4),
      height: Math.max(hit.h, 4),
      color: rgb(0, 0, 0),
      borderWidth: 0,
    });
  }

  onProgress?.(70, "Locking redacted pages…");
  const intermediate = await pdf.save();
  const { flattenPdfLocal } = await import("./flatten-pdf");
  const flattened = await flattenPdfLocal(
    new File([new Uint8Array(intermediate)], file.name, { type: "application/pdf" }),
    (p, message) => onProgress?.(70 + Math.round(p * 0.28), message)
  );

  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  const kinds = [...new Set(unique.map((h) => h.kind.split("-")[0]))];
  return {
    blob: flattened.blob,
    filename: `${base}-redacted.pdf`,
    redactionCount: unique.length,
    kinds,
  };
}
