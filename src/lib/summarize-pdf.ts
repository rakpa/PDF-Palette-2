/**
 * Local extractive summarize + keyword Q&A — no cloud AI.
 */

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

/** Split into usable chunks even when the PDF has short lines or no periods. */
export function sentences(text: string): string[] {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return [];

  const fromPunctuation = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const fromLines = cleaned
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  const fromChunks: string[] = [];
  if (cleaned.length >= 8) {
    // Sliding chunks for very short / list-like docs.
    const words = cleaned.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 12) {
      const chunk = words.slice(i, i + 18).join(" ");
      if (chunk.length >= 8) fromChunks.push(chunk);
    }
  }

  const merged = [...fromPunctuation, ...fromLines, ...fromChunks];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of merged) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function buildSummaryFromText(fileName: string, text: string): string {
  const list = sentences(text);
  if (list.length === 0) {
    throw new Error("No text was found. Try OCR PDF first if this is a scanned document.");
  }

  const freq = new Map<string, number>();
  for (const s of list) {
    for (const w of s.toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const scored = list.map((s, index) => {
    const words = s.toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    const score =
      words.reduce((sum, w) => sum + (freq.get(w) || 0), 0) / Math.max(words.length, 1) +
      (index < 3 ? 1.5 : 0);
    return { s, score, index };
  });
  scored.sort((a, b) => b.score - a.score);

  const pick = Math.min(8, Math.max(1, Math.min(list.length, Math.ceil(list.length * 0.35))));
  const chosen = scored
    .slice(0, pick)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.s);

  return [
    `Summary of ${fileName}`,
    `Generated locally in your browser (extractive — no cloud AI).`,
    "",
    ...chosen.map((s, i) => `${i + 1}. ${s}`),
    "",
  ].join("\n");
}

/** Simple extractive summary — no external AI, runs in the browser. */
export async function summarizePdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string; summary: string; text: string }> {
  const { extractPdfTextString } = await import("./extract-text");
  const text = await extractPdfTextString(file, (p, m) =>
    onProgress?.(Math.min(70, p * 0.7), m)
  );
  onProgress?.(75, "Building summary…");
  const summary = buildSummaryFromText(file.name, text);
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: new Blob([summary], { type: "text/plain;charset=utf-8" }),
    filename: `${base}-summary.txt`,
    summary,
    text,
  };
}

/** Answer a question by finding the most relevant passages in the PDF text. */
export function answerFromPdfText(text: string, question: string): string {
  const qWords = (question.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(
    (w) =>
      ![
        "the",
        "and",
        "for",
        "what",
        "when",
        "where",
        "how",
        "who",
        "why",
        "does",
        "this",
        "that",
        "with",
        "from",
        "about",
        "please",
      ].includes(w)
  );
  if (qWords.length === 0) {
    return "Ask a more specific question about the document.";
  }
  const list = sentences(text);
  if (list.length === 0) return "No searchable text was found in this PDF.";

  const ranked = list
    .map((s) => {
      const lower = s.toLowerCase();
      const hits = qWords.reduce((n, w) => n + (lower.includes(w) ? 1 : 0), 0);
      return { s, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (ranked.length === 0) {
    return "I could not find a matching passage. Try different keywords from the document.";
  }

  return [
    "Relevant passages (local keyword match — not a cloud AI):",
    "",
    ...ranked.slice(0, 4).map((x, i) => `${i + 1}. ${x.s}`),
  ].join("\n");
}
