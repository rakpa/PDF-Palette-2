import { extractPdfTextString } from "./extract-text";

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

/** Simple extractive summary — no external AI, runs in the browser. */
export async function summarizePdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string; summary: string }> {
  const text = await extractPdfTextString(file, (p, m) =>
    onProgress?.(Math.min(70, p * 0.7), m)
  );
  onProgress?.(75, "Building summary…");

  const list = sentences(text);
  if (list.length === 0) {
    throw new Error("Not enough text to summarize. Try OCR PDF first for scans.");
  }

  const freq = new Map<string, number>();
  for (const s of list) {
    for (const w of s.toLowerCase().match(/[a-z]{4,}/g) || []) {
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }

  const scored = list.map((s, index) => {
    const words = s.toLowerCase().match(/[a-z]{4,}/g) || [];
    const score =
      words.reduce((sum, w) => sum + (freq.get(w) || 0), 0) / Math.max(words.length, 1) +
      (index < 3 ? 2 : 0);
    return { s, score, index };
  });
  scored.sort((a, b) => b.score - a.score);

  const pick = Math.min(8, Math.max(3, Math.ceil(list.length * 0.12)));
  const chosen = scored
    .slice(0, pick)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.s);

  const summary = [
    `Summary of ${file.name}`,
    `Generated locally in your browser (extractive — no cloud AI).`,
    "",
    ...chosen.map((s, i) => `${i + 1}. ${s}`),
    "",
  ].join("\n");

  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: new Blob([summary], { type: "text/plain;charset=utf-8" }),
    filename: `${base}-summary.txt`,
    summary,
  };
}

/** Answer a question by finding the most relevant sentences in the PDF text. */
export function answerFromPdfText(text: string, question: string): string {
  const qWords = (question.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(
    (w) => !["the", "and", "for", "what", "when", "where", "how", "who", "why", "does", "this", "that", "with", "from"].includes(w)
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
