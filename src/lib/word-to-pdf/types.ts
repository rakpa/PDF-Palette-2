/**
 * Flow-first model of a Word document.
 *
 * Coordinates are in points (1/72 inch), origin at the top-left of the page,
 * y growing downwards — the same space the PDF emitter converts to pdf-lib's
 * bottom-left origin. Extract talks in Word's own units (twips / EMUs / half
 * points) and converts once, so layout and emit never see those.
 */

export type Align = "left" | "center" | "right" | "justify";

export type RunStyle = {
  family: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  vertAlign?: "super" | "sub";
};

export type TextItem = {
  kind: "text";
  text: string;
  style: RunStyle;
  link?: string;
};

export type BreakItem = { kind: "break"; break: "line" | "page" };
export type TabItem = { kind: "tab" };
export type ImageItem = {
  kind: "image";
  data: Uint8Array;
  type: "png" | "jpg";
  width: number;
  height: number;
};

export type Inline = TextItem | BreakItem | TabItem | ImageItem;

export type ParagraphBlock = {
  kind: "paragraph";
  align: Align;
  indentLeft: number;
  indentRight: number;
  /** Positive = first-line indent; negative = hanging indent. */
  indentFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  /** Line spacing. When `lineExact` is set this is a point height; otherwise a 240-based multiplier (240 = single). */
  line: number;
  lineExact: boolean;
  numbering?: { text: string; width: number };
  runs: Inline[];
};

export type BorderEdge = {
  color: string;
  width: number;
};

export type Borders = {
  top?: BorderEdge;
  right?: BorderEdge;
  bottom?: BorderEdge;
  left?: BorderEdge;
  insideH?: BorderEdge;
  insideV?: BorderEdge;
};

export type TableCellBlock = {
  span: number;
  vMerge?: "restart" | "continue";
  shading?: string;
  borders: Borders;
  valign: "top" | "center" | "bottom";
  width: number;
  blocks: Block[];
};

export type TableRowBlock = {
  cells: TableCellBlock[];
  height?: number;
  header: boolean;
};

export type TableBlock = {
  kind: "table";
  rows: TableRowBlock[];
  width: number;
  indent: number;
  borders: Borders;
};

export type Block = ParagraphBlock | TableBlock;

export type SectionMargins = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type Section = {
  width: number;
  height: number;
  margins: SectionMargins;
  headerDistance: number;
  footerDistance: number;
  header: Block[];
  footer: Block[];
  body: Block[];
};

export type WordDocument = {
  sections: Section[];
};

/** Positioned output of the layout stage, ready to paint. */
export type PlacedSpan = {
  text: string;
  x: number;
  /** Baseline, measured from the top of the page. */
  baseline: number;
  width: number;
  fontSize: number;
  style: RunStyle;
};

export type PlacedImage = {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
  type: "png" | "jpg";
};

export type PlacedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

export type PlacedRule = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  color: string;
};

export type PlacedPage = {
  width: number;
  height: number;
  spans: PlacedSpan[];
  images: PlacedImage[];
  rects: PlacedRect[];
  rules: PlacedRule[];
};
