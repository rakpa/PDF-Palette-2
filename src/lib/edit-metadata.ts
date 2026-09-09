import { PDFDocument } from "pdf-lib";

export type PdfMetadataFields = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
};

export async function readPdfMetadata(file: File): Promise<PdfMetadataFields> {
  const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  return {
    title: pdf.getTitle() ?? "",
    author: pdf.getAuthor() ?? "",
    subject: pdf.getSubject() ?? "",
    keywords: pdf.getKeywords() ?? "",
    creator: pdf.getCreator() ?? "",
    producer: pdf.getProducer() ?? "",
  };
}

export async function editMetadataLocal(
  file: File,
  fields: PdfMetadataFields,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  onProgress?.(10, "Opening PDF…");
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(await file.arrayBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|encrypt/i.test(message)) {
      throw new Error("This PDF is password protected. Unlock it first.");
    }
    throw new Error("This file could not be read as a PDF.");
  }

  onProgress?.(40, "Updating metadata…");
  pdf.setTitle(fields.title.trim());
  pdf.setAuthor(fields.author.trim());
  pdf.setSubject(fields.subject.trim());
  const keywords = fields.keywords
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter(Boolean);
  pdf.setKeywords(keywords);
  if (fields.creator.trim()) pdf.setCreator(fields.creator.trim());
  if (fields.producer.trim()) pdf.setProducer(fields.producer.trim());
  pdf.setModificationDate(new Date());

  onProgress?.(85, "Saving…");
  const saved = await pdf.save();
  onProgress?.(100, "Done");
  const base = file.name.replace(/\.pdf$/i, "") || "document";
  return {
    blob: new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
    filename: `${base}-metadata.pdf`,
  };
}
