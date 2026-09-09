import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type HeaderFooterOptions = {
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
  fontSize: number;
  margin: number;
};

export const DEFAULT_HEADERS_FOOTERS: HeaderFooterOptions = {
  headerLeft: "",
  headerCenter: "",
  headerRight: "",
  footerLeft: "",
  // Pre-filled so "Add headers & footers" works without empty-form failure.
  footerCenter: "Page {n} of {N}",
  footerRight: "",
  fontSize: 10,
  margin: 36,
};

function spellable(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out += char;
  }
  return out;
}

function expand(template: string, page: number, total: number): string {
  return spellable(
    template.replace(/\{n\}/g, String(page)).replace(/\{N\}/g, String(total)).replace(/\{date\}/g, new Date().toLocaleDateString())
  );
}

export async function addHeadersFootersLocal(
  file: File,
  options: HeaderFooterOptions,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(8, "Opening PDF…");
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(await file.arrayBuffer());
  } catch {
    throw new Error("This file could not be read as a PDF.");
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = Math.max(6, Math.min(24, options.fontSize || 10));
  const margin = Math.max(12, options.margin || 36);
  const pages = pdf.getPages();
  const total = pages.length;

  const anyText = [
    options.headerLeft,
    options.headerCenter,
    options.headerRight,
    options.footerLeft,
    options.footerCenter,
    options.footerRight,
  ].some((t) => t.trim());
  if (!anyText) {
    throw new Error("Enter at least one header or footer line.");
  }

  for (let i = 0; i < total; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const pageNum = i + 1;
    const slots: { text: string; x: number; y: number; align: "left" | "center" | "right" }[] = [
      { text: expand(options.headerLeft, pageNum, total), x: margin, y: height - margin, align: "left" },
      { text: expand(options.headerCenter, pageNum, total), x: width / 2, y: height - margin, align: "center" },
      { text: expand(options.headerRight, pageNum, total), x: width - margin, y: height - margin, align: "right" },
      { text: expand(options.footerLeft, pageNum, total), x: margin, y: margin - size, align: "left" },
      { text: expand(options.footerCenter, pageNum, total), x: width / 2, y: margin - size, align: "center" },
      { text: expand(options.footerRight, pageNum, total), x: width - margin, y: margin - size, align: "right" },
    ];

    for (const slot of slots) {
      if (!slot.text) continue;
      const tw = font.widthOfTextAtSize(slot.text, size);
      let x = slot.x;
      if (slot.align === "center") x = slot.x - tw / 2;
      if (slot.align === "right") x = slot.x - tw;
      page.drawText(slot.text, {
        x: Math.max(4, x),
        y: Math.max(4, slot.y),
        size,
        font,
        color: rgb(0.15, 0.15, 0.18),
      });
    }
    onProgress?.(15 + Math.round(((i + 1) / total) * 75), `Page ${pageNum} of ${total}…`);
  }

  onProgress?.(95, "Saving…");
  const saved = await pdf.save();
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}-headers.pdf`,
  };
}
