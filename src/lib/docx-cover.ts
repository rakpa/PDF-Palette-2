import { openZip, decodeUtf8 } from "./office/zip";
import { createZip, type ZipEntry } from "./zip-write";
import { pdfjsLib } from "./pdf-to-word/read";

/**
 * CloudConvert (Apryse PDF2Word) often reconstructs a book cover as clipped
 * floating shapes. We do not send cover options — there aren't any — so when
 * page 1 looks like a cover, pin a picture of that PDF page as the first Word
 * page. Text pages are left to CloudConvert.
 */

const DOCUMENT = "word/document.xml";
const RELS = "word/_rels/document.xml.rels";
const TYPES = "[Content_Types].xml";
const MEDIA = "word/media/cover.jpg";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const COVER_MAX_CHARS = 800;
const COVER_SPARSE_CHARS = 40;
const COVER_DPI = 150;
const COVER_JPEG_QUALITY = 0.88;

const EMU_PER_PT = 12700;

export type CoverImage = {
  jpeg: Uint8Array;
  widthPt: number;
  heightPt: number;
};

export async function prepareCoverFromPdf(file: File): Promise<CoverImage | null> {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    verbosity: 0,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    if (!(await pageLooksLikeCover(page))) {
      page.cleanup();
      return null;
    }

    const viewport1 = page.getViewport({ scale: 1 });
    const scale = COVER_DPI / 72;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) {
      page.cleanup();
      return null;
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    page.cleanup();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COVER_JPEG_QUALITY)
    );
    if (!blob) return null;
    return {
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      widthPt: viewport1.width,
      heightPt: viewport1.height,
    };
  } catch {
    return null;
  } finally {
    void task.destroy().catch(() => undefined);
  }
}

async function pageLooksLikeCover(
  page: import("pdfjs-dist").PDFPageProxy
): Promise<boolean> {
  const [text, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  let chars = 0;
  for (const item of text.items) {
    if (!("str" in item)) continue;
    chars += String(item.str).replace(/\s/g, "").length;
  }
  const OPS = pdfjsLib.OPS as unknown as Record<string, number>;
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintJpegXObject,
    OPS.paintImageXObjectRepeat,
  ]);
  let images = 0;
  for (const fn of ops.fnArray) {
    if (imageOps.has(fn)) images += 1;
  }
  if (chars <= COVER_SPARSE_CHARS) return true;
  return images >= 1 && chars <= COVER_MAX_CHARS;
}

export async function pinCoverImage(blob: Blob, cover: CoverImage): Promise<Blob> {
  try {
    const zip = await openZip(await blob.arrayBuffer());
    const names = zip.list();
    if (!names.includes(DOCUMENT)) return blob;

    const documentBytes = await zip.read(DOCUMENT);
    if (!documentBytes) return blob;
    const relsBytes = await zip.read(RELS);
    const typesBytes = await zip.read(TYPES);

    const relId = nextRelId(relsBytes ? decodeUtf8(relsBytes) : "");
    const drawing = coverParagraph(relId, cover.widthPt, cover.heightPt);
    const documentXml = replaceFirstPage(decodeUtf8(documentBytes), drawing);
    if (documentXml === decodeUtf8(documentBytes)) return blob;

    const encoder = new TextEncoder();
    const entries: ZipEntry[] = [];
    for (const name of names) {
      if (name.endsWith("/")) continue;
      if (name === DOCUMENT) {
        entries.push({ name, data: encoder.encode(documentXml) });
        continue;
      }
      if (name === RELS) {
        entries.push({ name, data: encoder.encode(upsertImageRel(decodeUtf8(relsBytes!), relId)) });
        continue;
      }
      if (name === TYPES) {
        entries.push({ name, data: encoder.encode(ensureJpgType(decodeUtf8(typesBytes!))) });
        continue;
      }
      if (name === MEDIA) continue;
      const data = await zip.read(name);
      if (data) entries.push({ name, data });
    }

    if (!names.includes(RELS)) {
      entries.push({ name: RELS, data: encoder.encode(upsertImageRel(emptyRels(), relId)) });
    }
    if (!names.includes(TYPES)) {
      entries.push({
        name: TYPES,
        data: encoder.encode(
          ensureJpgType(
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`
          )
        ),
      });
    }
    entries.push({ name: MEDIA, data: cover.jpeg });

    return new Blob([await createZip(entries)], { type: blob.type });
  } catch {
    return blob;
  }
}

function emptyRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
}

function nextRelId(relsXml: string): string {
  let max = 0;
  for (const match of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return `rId${max + 1}`;
}

function upsertImageRel(relsXml: string, relId: string): string {
  const rel = `<Relationship Id="${relId}" Type="${IMAGE_REL}" Target="media/cover.jpg"/>`;
  if (relsXml.includes("</Relationships>")) {
    return relsXml.replace("</Relationships>", `${rel}</Relationships>`);
  }
  return emptyRels().replace("</Relationships>", `${rel}</Relationships>`);
}

function ensureJpgType(typesXml: string): string {
  if (/Extension="jpe?g"/i.test(typesXml)) return typesXml;
  return typesXml.replace(
    /<Types(\s[^>]*)?>/,
    (open) => `${open}<Default Extension="jpg" ContentType="image/jpeg"/>`
  );
}

function coverParagraph(relId: string, widthPt: number, heightPt: number): string {
  const cx = Math.max(1, Math.round(widthPt * EMU_PER_PT));
  const cy = Math.max(1, Math.round(heightPt * EMU_PER_PT));
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>` +
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapNone/>` +
    `<wp:docPr id="1" name="Cover"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="1" name="Cover"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>` +
    `</wp:anchor></w:drawing></w:r></w:p>`
  );
}

/** Replace first-page body content, keeping the page/section break and the rest. */
export function replaceFirstPage(xml: string, paragraph: string): string {
  const bodyOpen = /<w:body(\s[^>]*)?>/.exec(xml);
  if (!bodyOpen) return xml;
  const openEnd = bodyOpen.index + bodyOpen[0].length;
  const rest = xml.slice(openEnd);

  const pageBr = /<w:br\b[^>]*w:type="page"[^/]*\/>/.exec(rest);
  if (pageBr) {
    const paraStart = rest.lastIndexOf("<w:p", pageBr.index);
    if (paraStart >= 0) {
      return xml.slice(0, openEnd) + paragraph + rest.slice(paraStart);
    }
  }

  const rendered = /<w:lastRenderedPageBreak\b/.exec(rest);
  if (rendered) {
    const paraStart = rest.lastIndexOf("<w:p", rendered.index);
    if (paraStart > 0) {
      return xml.slice(0, openEnd) + paragraph + rest.slice(paraStart);
    }
  }

  const sectionBreak = /<w:p\b[\s\S]*?<w:sectPr\b[\s\S]*?<\/w:sectPr>[\s\S]*?<\/w:p>/.exec(rest);
  const trailing = rest.lastIndexOf("<w:sectPr");
  if (sectionBreak && trailing >= 0 && sectionBreak.index < trailing) {
    return xml.slice(0, openEnd) + paragraph + rest.slice(sectionBreak.index);
  }

  if (trailing >= 0 && !pageBr) {
    const before = rest.slice(0, trailing);
    // Only safe on a one-page document (no later page break).
    if (!/<w:lastRenderedPageBreak\b/.test(before)) {
      return xml.slice(0, openEnd) + paragraph + rest.slice(trailing);
    }
  }

  return xml.slice(0, openEnd) + paragraph + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` + rest;
}
