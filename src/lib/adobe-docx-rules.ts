import { openZip, decodeUtf8 } from "./office/zip";
import { createZip, type ZipEntry } from "./zip-write";

/**
 * Repairs the chapter rules in a DOCX produced by Adobe's Export PDF.
 *
 * A horizontal rule in the source PDF is a vector stroke at fixed coordinates,
 * so Adobe emits it as a floating shape anchored to a paragraph at a fixed
 * vertical offset. It emits two variants, and only one of them survives Word's
 * reflow:
 *
 *   <wp:wrapTopAndBottom/> — Word reserves space, text moves out of the way.
 *   <wp:wrapNone/>         — the shape floats over the text with no wrapping.
 *
 * Once Word re-breaks the lines the offset no longer points below the heading,
 * and every `wrapNone` rule ends up drawn straight through whatever text has
 * moved under it — a whole line of a table of contents struck out. Switching
 * those to the wrapping Adobe already uses for the rules that come out right
 * keeps the rule and stops the overlap.
 *
 * Deliberately narrow: only hairlines (a rule is ~0.1pt tall) that are set to
 * `wrapNone`. Images and every other shape are left exactly as Adobe wrote them.
 */

/** 1pt in EMU. A rule is 1270 EMU tall; anything taller is a real shape. */
const HAIRLINE_MAX_EMU = 12700;

const DOCUMENT = "word/document.xml";

function repairDocumentXml(xml: string): { xml: string; fixed: number } {
  let fixed = 0;
  const repaired = xml.replace(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, (block) => {
    if (!block.includes("<wp:wrapNone/>")) return block;
    const extent = /<wp:extent cx="\d+" cy="(\d+)"/.exec(block);
    if (!extent || Number(extent[1]) > HAIRLINE_MAX_EMU) return block;

    fixed += 1;
    return (
      block
        .replace("<wp:wrapNone/>", "<wp:wrapTopAndBottom/>")
        .replace('behindDoc="0"', 'behindDoc="1"')
        // The VML fallback that older readers use has to agree with the above.
        .replace('<w10:wrap type="none"/>', '<w10:wrap type="topAndBottom"/>')
        .replace(/z-index:(\d)/g, "z-index:-$1")
    );
  });
  return { xml: repaired, fixed };
}

/**
 * Returns a repaired copy of the file, or the original when there is nothing
 * to fix. Never throws: a document this cannot parse is passed through
 * untouched, since a slightly ugly rule beats a failed conversion.
 */
export async function repairAdobeDocxRules(blob: Blob): Promise<Blob> {
  try {
    const zip = await openZip(await blob.arrayBuffer());
    const names = zip.list();
    if (!names.includes(DOCUMENT)) return blob;

    const original = await zip.read(DOCUMENT);
    if (!original) return blob;

    const { xml, fixed } = repairDocumentXml(decodeUtf8(original));
    if (fixed === 0) return blob;

    const encoder = new TextEncoder();
    const entries: ZipEntry[] = [];
    for (const name of names) {
      if (name.endsWith("/")) continue;
      if (name === DOCUMENT) {
        entries.push({ name, data: encoder.encode(xml) });
        continue;
      }
      const data = await zip.read(name);
      if (data) entries.push({ name, data });
    }

    return new Blob([await createZip(entries)], { type: blob.type });
  } catch {
    return blob;
  }
}
