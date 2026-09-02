import { PDFHexString, PDFName } from "pdf-lib";
import type { PDFDocument, PDFPage, PDFRef } from "pdf-lib";

/**
 * A font that carries text without drawing it.
 *
 * The visible page is the captured picture, so the text layer only has to be
 * selectable, searchable and copyable — no glyph of it is ever painted. That
 * frees us from the fourteen standard fonts and their Latin-only encoding: a
 * Type0 font with Identity-H encoding lets a character be written as its own
 * UTF-16 code unit, and a ToUnicode map that is the identity tells any reader
 * exactly which character that was. Cyrillic, Greek, Japanese, Arabic and the
 * rest come back out of the finished PDF as themselves.
 *
 * Every code is one em wide, which is what `Tz` is for: each line is squeezed
 * to the width the browser actually measured, so selection follows the text.
 */

const TO_UNICODE_CMAP = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <ffff>
endcodespacerange
1 beginbfrange
<0000> <ffff> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

export interface CarrierFont {
  ref: PDFRef;
  keys: WeakMap<PDFPage, PDFName>;
}

export function createCarrierFont(pdf: PDFDocument): CarrierFont {
  const context = pdf.context;

  const toUnicode = context.register(
    context.stream(TO_UNICODE_CMAP, { Length: TO_UNICODE_CMAP.length })
  );

  // No font file: the glyphs are never drawn, so a reader is free to
  // substitute whatever it likes for them.
  const descriptor = context.register(
    context.obj({
      Type: "FontDescriptor",
      FontName: PDFName.of("PdfPaletteTextLayer"),
      Flags: 4,
      FontBBox: [0, -200, 1000, 900],
      ItalicAngle: 0,
      Ascent: 800,
      Descent: -200,
      CapHeight: 700,
      StemV: 80,
    })
  );

  const descendant = context.register(
    context.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: PDFName.of("PdfPaletteTextLayer"),
      CIDSystemInfo: { Registry: PDFHexString.fromText("Adobe"), Ordering: PDFHexString.fromText("Identity"), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: 1000,
      CIDToGIDMap: PDFName.of("Identity"),
    })
  );

  const ref = context.register(
    context.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: PDFName.of("PdfPaletteTextLayer"),
      Encoding: PDFName.of("Identity-H"),
      DescendantFonts: [descendant],
      ToUnicode: toUnicode,
    })
  );

  return { ref, keys: new WeakMap() };
}

export function carrierKeyFor(font: CarrierFont, page: PDFPage): PDFName {
  const existing = font.keys.get(page);
  if (existing) return existing;
  const name = page.node.newFontDictionary("U", font.ref);
  font.keys.set(page, name);
  return name;
}

/**
 * Encode text as Identity-H codes. Characters outside the basic plane are
 * dropped: they would need a surrogate pair, which the identity map cannot
 * describe as a single character.
 */
export function encodeIdentity(text: string): { hex: PDFHexString; units: number } | null {
  let hex = "";
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xffff) continue;
    hex += code.toString(16).padStart(4, "0");
    units++;
  }
  return units > 0 ? { hex: PDFHexString.of(hex), units } : null;
}
