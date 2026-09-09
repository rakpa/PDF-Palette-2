import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

type Block =
  | { kind: "h1" | "h2" | "h3" | "p" | "li" | "code"; text: string }
  | { kind: "blank" };

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: Block[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  for (const raw of lines) {
    if (raw.trimStart().startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", text: codeBuf.join("\n") });
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    if (/^\s*$/.test(raw)) {
      blocks.push({ kind: "blank" });
      continue;
    }
    if (raw.startsWith("### ")) blocks.push({ kind: "h3", text: raw.slice(4).trim() });
    else if (raw.startsWith("## ")) blocks.push({ kind: "h2", text: raw.slice(3).trim() });
    else if (raw.startsWith("# ")) blocks.push({ kind: "h1", text: raw.slice(2).trim() });
    else if (/^\s*[-*+]\s+/.test(raw)) blocks.push({ kind: "li", text: raw.replace(/^\s*[-*+]\s+/, "") });
    else if (/^\s*\d+\.\s+/.test(raw)) blocks.push({ kind: "li", text: raw.replace(/^\s*\d+\.\s+/, "") });
    else blocks.push({ kind: "p", text: raw.trim() });
  }
  if (inCode && codeBuf.length) blocks.push({ kind: "code", text: codeBuf.join("\n") });
  return blocks;
}

function wrap(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function stripInline(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

export async function markdownToPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(8, "Reading Markdown…");
  const source = await file.text();
  if (!source.trim()) throw new Error("This Markdown file is empty.");

  onProgress?.(20, "Laying out pages…");
  const pdf = await PDFDocument.create();
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;
  const blocks = parseMarkdown(source);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (need: number) => {
    if (y - need < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === "blank") {
      y -= 10;
      continue;
    }
    const text = stripInline(block.text);
    let font = sans;
    let size = 11;
    let gap = 16;
    let indent = 0;
    if (block.kind === "h1") {
      font = sansBold;
      size = 22;
      gap = 28;
      y -= 8;
    } else if (block.kind === "h2") {
      font = sansBold;
      size = 16;
      gap = 22;
      y -= 6;
    } else if (block.kind === "h3") {
      font = sansBold;
      size = 13;
      gap = 18;
      y -= 4;
    } else if (block.kind === "li") {
      indent = 14;
    } else if (block.kind === "code") {
      font = mono;
      size = 9;
      gap = 12;
    }

    const lines =
      block.kind === "code"
        ? text.split("\n")
        : wrap(block.kind === "li" ? `• ${text}` : text, font, size, maxWidth - indent);

    for (const line of lines) {
      ensureSpace(gap);
      page.drawText(line.slice(0, 500), {
        x: MARGIN + indent,
        y: y - size,
        size,
        font,
        color: rgb(0.1, 0.1, 0.12),
      });
      y -= gap;
    }
    if (block.kind.startsWith("h")) y -= 4;
    onProgress?.(20 + Math.round(((i + 1) / blocks.length) * 70), "Building PDF…");
  }

  onProgress?.(98, "Saving…");
  const saved = await pdf.save();
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.(md|markdown|txt)$/i, "") || "document";
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}.pdf`,
  };
}
