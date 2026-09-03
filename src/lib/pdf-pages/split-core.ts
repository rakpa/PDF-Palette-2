import { PDFDocument } from "pdf-lib";

export type SplitRange = { start: number; end: number };

export type SplitPdfOptions = {
  merge?: boolean;
  baseName?: string;
};

export type SplitPart = {
  ok: boolean;
  message: string;
  bytes?: Uint8Array;
  filename?: string;
};

function indicesForRange(range: SplitRange, pageCount: number): number[] {
  const indices: number[] = [];
  for (let p = range.start - 1; p < range.end; p++) {
    if (p >= 0 && p < pageCount) indices.push(p);
  }
  return indices;
}

async function pdfFromIndices(
  source: Awaited<ReturnType<typeof PDFDocument.load>>,
  pageIndices: number[]
): Promise<Uint8Array> {
  const next = await PDFDocument.create();
  const pages = await next.copyPages(source, pageIndices);
  pages.forEach((page) => next.addPage(page));
  return next.save();
}

function rangeLabel(range: SplitRange): string {
  return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}

export async function splitPdfBytes(
  data: Uint8Array,
  ranges: SplitRange[],
  options?: SplitPdfOptions
): Promise<SplitPart[]> {
  const pdf = await PDFDocument.load(data);
  const pageCount = pdf.getPageCount();
  const base = options?.baseName?.replace(/\.pdf$/i, "") || "split";

  if (options?.merge) {
    const pageIndices: number[] = [];
    for (const range of ranges) {
      pageIndices.push(...indicesForRange(range, pageCount));
    }
    if (pageIndices.length === 0) {
      return [
        {
          ok: false,
          message: `Those pages are out of range (document has ${pageCount} page${pageCount === 1 ? "" : "s"}).`,
        },
      ];
    }
    const bytes = await pdfFromIndices(pdf, pageIndices);
    return [
      {
        ok: true,
        message: `Extracted ${pageIndices.length} page${pageIndices.length === 1 ? "" : "s"} into one PDF.`,
        bytes,
        filename: `${base}_ranges.pdf`,
      },
    ];
  }

  const results: SplitPart[] = [];
  for (const range of ranges) {
    const pageIndices = indicesForRange(range, pageCount);
    if (pageIndices.length === 0) {
      results.push({
        ok: false,
        message: `Pages ${range.start}-${range.end} are out of range (document has ${pageCount} page${pageCount === 1 ? "" : "s"}).`,
      });
      continue;
    }
    const bytes = await pdfFromIndices(pdf, pageIndices);
    results.push({
      ok: true,
      message: `Pages ${range.start}-${range.end} extracted`,
      bytes,
      filename: `${base}_${rangeLabel(range)}.pdf`,
    });
  }
  return results;
}
