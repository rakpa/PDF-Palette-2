/**
 * Geometry-first model of a PDF page.
 *
 * Everything in this model lives in "device points": 1/72 inch, origin at the
 * top-left of the *rotated* page, y growing downwards. That matches how Word
 * measures a page, so the layout and emit stages never have to think about
 * PDF's bottom-left origin or the page's /Rotate entry again.
 */

export type Rect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type FontStyle = {
  /** Word-resolvable family name, e.g. "Times New Roman". */
  family: string;
  bold: boolean;
  italic: boolean;
  /** Font ascent/descent in em units, used to place the glyph box. */
  ascent: number;
  descent: number;
};

export type PdfSpan = {
  text: string;
  /** Left edge of the glyph run. */
  x: number;
  /** Right edge of the glyph run. */
  xEnd: number;
  /** Baseline, measured from the top of the page. */
  baseline: number;
  /** Top/bottom of the glyph box (baseline offset by ascent/descent). */
  yTop: number;
  yBottom: number;
  fontSize: number;
  font: FontStyle;
  color?: string;
  underline?: boolean;
  strike?: boolean;
  /** Set when the run sits noticeably above/below its line's baseline. */
  vertAlign?: "super" | "sub";
  /** Rotation of the run in degrees; only ~0 participates in normal flow. */
  angle: number;
  link?: string;
  /** Width of a space in this run's font, used for gap analysis. */
  spaceWidth: number;
};

export type PdfLine = {
  spans: PdfSpan[];
  x: number;
  xEnd: number;
  yTop: number;
  yBottom: number;
  baseline: number;
  /** Dominant font size of the line. */
  fontSize: number;
  /** Background fill covering the line, if any. */
  shading?: string;
};

export type PdfImage = {
  rect: Rect;
  data: Uint8Array;
  type: "png" | "jpg";
};

/** A stroked or thin-filled axis-aligned segment — table rules, underlines. */
export type PdfRule = {
  horizontal: boolean;
  /** Constant coordinate (y for horizontal rules, x for vertical ones). */
  pos: number;
  /** Extent along the rule. */
  start: number;
  end: number;
  thickness: number;
  color?: string;
};

/** A filled axis-aligned rectangle — cell shading, banners, highlights. */
export type PdfFill = {
  rect: Rect;
  color: string;
};

export type PageContent = {
  pageNumber: number;
  width: number;
  height: number;
  lines: PdfLine[];
  images: PdfImage[];
  rules: PdfRule[];
  fills: PdfFill[];
  /**
   * Areas painted by a shading (`sh`). Their colour lives in a PDF function,
   * so it is not resolved here — a caller that can sample the rendered page
   * reads it off that. The layout engine ignores them.
   */
  shadings: PdfFill[];
  /** Bounding boxes of dense vector artwork rendered as pictures. */
  artwork: PdfImage[];
  /** Total non-space characters recovered from the text layer. */
  textChars: number;
};
