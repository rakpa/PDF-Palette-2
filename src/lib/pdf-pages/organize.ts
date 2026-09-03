import { PDFDocument, degrees } from "pdf-lib";
import { normalizeRotation } from "./geometry";

/** One page of the result: which source page it comes from, and how it sits. */
export interface PagePlacement {
  /** Zero-based index into the source document. */
  source: number;
  /** Extra rotation to apply on top of whatever the source page already has. */
  turn?: number;
}

export class PdfPagesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfPagesError";
  }
}

async function open(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypted/i.test(message)) {
      throw new PdfPagesError("This PDF is password protected. Unlock it first.");
    }
    throw new PdfPagesError("This file could not be read as a PDF.");
  }
}

/**
 * Rebuild a document from an ordered plan.
 *
 * Everything the organise, remove, extract and reorder tools do is the same
 * operation underneath — say which source pages appear, in what order, turned
 * which way — so they all come through here. Pages are copied rather than
 * redrawn, so their content arrives untouched.
 */
export async function rebuildPages(
  bytes: Uint8Array,
  plan: PagePlacement[]
): Promise<Uint8Array> {
  const source = await open(bytes);
  const count = source.getPageCount();

  const wanted = plan.filter((item) => item.source >= 0 && item.source < count);
  if (wanted.length === 0) {
    throw new PdfPagesError("That would leave the document with no pages.");
  }

  const output = await PDFDocument.create();
  const copied = await output.copyPages(source, wanted.map((item) => item.source));

  copied.forEach((page, index) => {
    const turn = wanted[index].turn ?? 0;
    if (turn) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + turn)));
    }
    output.addPage(page);
  });

  const title = source.getTitle();
  if (title) output.setTitle(title);

  return output.save();
}

/** Pages the reader listed, as zero-based indices, in the order given. */
export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await open(bytes)).getPageCount();
}

export async function removePages(bytes: Uint8Array, remove: number[]): Promise<Uint8Array> {
  const drop = new Set(remove);
  const count = await pageCount(bytes);
  const keep: PagePlacement[] = [];
  for (let index = 0; index < count; index++) {
    if (!drop.has(index)) keep.push({ source: index });
  }
  if (keep.length === 0) {
    throw new PdfPagesError("That would remove every page. Leave at least one.");
  }
  return rebuildPages(bytes, keep);
}

export async function extractPages(bytes: Uint8Array, keep: number[]): Promise<Uint8Array> {
  if (keep.length === 0) throw new PdfPagesError("Choose at least one page to extract.");
  return rebuildPages(bytes, keep.map((source) => ({ source })));
}
