/** A4 at 96 CSS pixels per inch, with Chrome's default 0.5in print margin. */
export const PX_PER_PT = 96 / 72;
export const PAGE_WIDTH_PT = 595.28;
export const PAGE_HEIGHT_PT = 841.89;
export const MARGIN_PT = 36;
export const CONTENT_WIDTH_PT = PAGE_WIDTH_PT - MARGIN_PT * 2;
export const CONTENT_HEIGHT_PT = PAGE_HEIGHT_PT - MARGIN_PT * 2;
export const CONTENT_WIDTH_PX = CONTENT_WIDTH_PT * PX_PER_PT;
export const CONTENT_HEIGHT_PX = CONTENT_HEIGHT_PT * PX_PER_PT;

/** One word, measured where the browser actually laid it out. */
export interface TextWord {
  text: string;
  /** Left edge, in CSS pixels from the left of the printable column. */
  x: number;
  /** Measured width, used to squeeze the substitute font onto its footprint. */
  width: number;
}

/** One line box of text, in CSS pixels relative to the top of the document. */
export interface TextLine {
  words: TextWord[];
  /** Distance from the document top to the text baseline. */
  baseline: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  family: "sans" | "serif" | "mono";
}

/** A box that should not be sliced in half by a page break. */
export interface AtomicBox {
  top: number;
  bottom: number;
}

export interface PageGeometry {
  /** Document-space y of each page's top edge. */
  breaks: number[];
  contentHeight: number;
}
