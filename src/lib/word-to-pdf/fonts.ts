import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";
import type { RunStyle } from "./types";

export type FontFace = "sans" | "serif" | "mono";

export type FontSet = {
  sans: PDFFont;
  sansBold: PDFFont;
  sansItalic: PDFFont;
  sansBoldItalic: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
  serifItalic: PDFFont;
  serifBoldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
  monoItalic: PDFFont;
  monoBoldItalic: PDFFont;
};

const MONO = /mono|courier|consol|menlo|monaco|cascadia|typewriter|code|fixed/i;
const SERIF = /times|serif|roman|georgia|garamond|cambria|palatino|book antiqua|minion|cambria|liberation serif/i;

export function classifyFamily(family: string | undefined): FontFace {
  const name = family ?? "";
  if (MONO.test(name)) return "mono";
  if (SERIF.test(name)) return "serif";
  return "sans";
}

export async function embedStandardFonts(pdf: PDFDocument): Promise<FontSet> {
  const [
    sans,
    sansBold,
    sansItalic,
    sansBoldItalic,
    serif,
    serifBold,
    serifItalic,
    serifBoldItalic,
    mono,
    monoBold,
    monoItalic,
    monoBoldItalic,
  ] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
    pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    pdf.embedFont(StandardFonts.TimesRoman),
    pdf.embedFont(StandardFonts.TimesRomanBold),
    pdf.embedFont(StandardFonts.TimesRomanItalic),
    pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    pdf.embedFont(StandardFonts.Courier),
    pdf.embedFont(StandardFonts.CourierBold),
    pdf.embedFont(StandardFonts.CourierOblique),
    pdf.embedFont(StandardFonts.CourierBoldOblique),
  ]);
  return {
    sans,
    sansBold,
    sansItalic,
    sansBoldItalic,
    serif,
    serifBold,
    serifItalic,
    serifBoldItalic,
    mono,
    monoBold,
    monoItalic,
    monoBoldItalic,
  };
}

export function pickFont(fonts: FontSet, style: RunStyle): PDFFont {
  const face = classifyFamily(style.family);
  if (face === "serif") {
    if (style.bold && style.italic) return fonts.serifBoldItalic;
    if (style.bold) return fonts.serifBold;
    if (style.italic) return fonts.serifItalic;
    return fonts.serif;
  }
  if (face === "mono") {
    if (style.bold && style.italic) return fonts.monoBoldItalic;
    if (style.bold) return fonts.monoBold;
    if (style.italic) return fonts.monoItalic;
    return fonts.mono;
  }
  if (style.bold && style.italic) return fonts.sansBoldItalic;
  if (style.bold) return fonts.sansBold;
  if (style.italic) return fonts.sansItalic;
  return fonts.sans;
}

/** Word / Unicode punctuation that StandardFonts can draw after a cheap remap. */
const PUNCT: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00AD": "",
  "\u200B": "",
  "\u200C": "",
  "\u200D": "",
  "\uFEFF": "",
  "\u00A0": " ",
  "\u202F": " ",
  "\u2009": " ",
  "\u2007": " ",
  "\u2026": "...",
  "\u2192": "->",
  "\u2190": "<-",
  "\u00B7": ".",
  "\u2044": "/",
};

export function foldPunctuation(text: string): string {
  return Array.from(text)
    .map((ch) => PUNCT[ch] ?? ch)
    .join("");
}

export function canEncode(font: PDFFont, text: string): boolean {
  if (!text) return true;
  try {
    font.widthOfTextAtSize(text, 12);
    return true;
  } catch {
    return false;
  }
}

export function widthOf(font: PDFFont, text: string, size: number): number {
  if (!text) return 0;
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return size * 0.5 * text.length;
  }
}
