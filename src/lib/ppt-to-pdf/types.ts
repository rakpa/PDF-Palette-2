/** A presentation, read into shapes with positions in points. */

export interface RunFormat {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
}

export interface TextRun {
  text: string;
  format: RunFormat;
}

export interface TextParagraph {
  runs: TextRun[];
  align: "left" | "center" | "right" | "justify";
  /** Indent level, 0–8; each step insets the text and changes the bullet. */
  level: number;
  bullet?: string;
  spaceBefore: number;
  spaceAfter: number;
  /** Multiple of the line height; 1 is single spacing. */
  lineSpacing: number;
}

export interface TextBody {
  paragraphs: TextParagraph[];
  anchor: "top" | "center" | "bottom";
  insets: { left: number; top: number; right: number; bottom: number };
  wrap: boolean;
}

export interface Picture {
  data: Uint8Array;
  type: "png" | "jpg";
}

export interface TableCell {
  text?: TextBody;
  fill?: string;
  span: number;
  rowSpan: number;
  merged: boolean;
}

export interface ShapeTable {
  columns: number[];
  rows: Array<{ height: number; cells: TableCell[] }>;
}

export interface Shape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise, in degrees. */
  rotation: number;
  fill?: string;
  line?: { color: string; width: number };
  picture?: Picture;
  text?: TextBody;
  table?: ShapeTable;
}

export interface Slide {
  shapes: Shape[];
  background?: string;
}

export interface Presentation {
  width: number;
  height: number;
  slides: Slide[];
}

export class PowerPointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PowerPointError";
  }
}
