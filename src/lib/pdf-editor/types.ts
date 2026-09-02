/**
 * Model for the PDF editor.
 *
 * Every coordinate here is in **display points**: 1/72 inch, measured from the
 * top-left of the page *as the reader sees it*, y growing downwards, with the
 * page's /Rotate already applied. That is the space the user is pointing at, so
 * it is the only space the UI ever has to think in. `geometry.ts` maps it back
 * to PDF user space at export time.
 */

export type Point = { x: number; y: number };

export type Box = { x: number; y: number; width: number; height: number };

export type TextAlign = "left" | "center" | "right";

export type FontId =
  | "helvetica"
  | "times"
  | "courier"
  | "signature-flow"
  | "signature-formal";

export type AnnotationBase = {
  id: string;
  /** Page this belongs to, by stable id — pages can be reordered or removed. */
  pageId: string;
} & Box;

export type TextAnnotation = AnnotationBase & {
  kind: "text";
  text: string;
  fontId: FontId;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** Multiplier on the font size. */
  lineHeight: number;
  background?: string;
};

export type ImageAnnotation = AnnotationBase & {
  kind: "image";
  /** PNG or JPEG bytes. */
  data: Uint8Array;
  mime: "image/png" | "image/jpeg";
  /** Distinguishes a placed signature from an ordinary picture in the UI. */
  role: "image" | "signature" | "initials";
  opacity: number;
};

export type ShapeKind = "rectangle" | "ellipse" | "line" | "arrow";

export type ShapeAnnotation = AnnotationBase & {
  kind: "shape";
  shape: ShapeKind;
  stroke: string;
  strokeWidth: number;
  fill?: string;
  opacity: number;
  /**
   * Which diagonal of the box a line or arrow runs along, and therefore which
   * end the arrowhead is on. A box alone cannot record the drag direction.
   */
  diagonal?: "tlbr" | "bltr";
};

export type InkAnnotation = AnnotationBase & {
  kind: "ink";
  /** Strokes in unit coordinates (0–1) within the box, so resizing is trivial. */
  strokes: Point[][];
  stroke: string;
  strokeWidth: number;
  opacity: number;
};

/** A translucent block over existing text, drawn with a multiply blend. */
export type HighlightAnnotation = AnnotationBase & {
  kind: "highlight";
  color: string;
};

/** An opaque block that covers existing content so it can be typed over. */
export type WhiteoutAnnotation = AnnotationBase & {
  kind: "whiteout";
  color: string;
};

export type Annotation =
  | TextAnnotation
  | ImageAnnotation
  | ShapeAnnotation
  | InkAnnotation
  | HighlightAnnotation
  | WhiteoutAnnotation;

export type AnnotationKind = Annotation["kind"];

/**
 * A page in the document being edited. `sourceIndex` points at the page in the
 * uploaded file; the list order is the output order, so pages can be moved,
 * duplicated or dropped without disturbing the annotations attached to them.
 */
export type EditorPage = {
  id: string;
  sourceIndex: number;
  /** Extra rotation applied on top of the source page's own, in degrees. */
  rotation: 0 | 90 | 180 | 270;
  /** Display size in points, with rotation applied. */
  width: number;
  height: number;
};

export type EditorTool =
  | "select"
  | "text"
  | "image"
  | "signature"
  | "initials"
  | "date"
  | "rectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "draw"
  | "highlight"
  | "whiteout";

export type EditorMode = "edit" | "sign";

/** A signature the user has created in this session. */
export type SavedSignature = {
  id: string;
  data: Uint8Array;
  mime: "image/png";
  /** Natural aspect ratio, used to size it sensibly when placed. */
  aspect: number;
  role: "signature" | "initials";
  label: string;
};
