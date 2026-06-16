import * as pdfjsLib from "pdfjs-dist";
import { Document, Packer, PageBreak, Paragraph, TextRun } from "docx";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export async function convertPdfToWordBrowser(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(10, "Reading PDF…");

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paragraphs: Paragraph[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    onProgress?.(10 + (pageNum / pdf.numPages) * 75, `Extracting page ${pageNum}…`);

    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .split(/\s{2,}|\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `[Page ${pageNum}]`, italics: true })],
        })
      );
    } else {
      for (const line of lines) {
        paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
      }
    }

    if (pageNum < pdf.numPages) {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  onProgress?.(90, "Building Word document…");

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });
  const blob = await Packer.toBlob(doc);
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";

  onProgress?.(100, "Done");
  return { blob, filename: `${baseName}.docx` };
}
