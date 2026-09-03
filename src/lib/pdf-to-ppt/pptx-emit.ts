import {
  createPackage,
  escapeXml,
  relationshipsXml,
  XML_HEADER,
  type Part,
} from "../office/ooxml-write";

/**
 * Writing a presentation.
 *
 * A .pptx needs a master, a layout and a theme before PowerPoint will open it
 * at all, even when every slide is blank — so those come from fixed templates
 * here, and the interesting work is the slides themselves.
 */

const EMU_PER_POINT = 12700;

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";

export interface OutRun {
  text: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

export interface OutParagraph {
  runs: OutRun[];
  align: "left" | "center" | "right" | "justify";
}

export interface OutTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  paragraphs: OutParagraph[];
}

export interface OutPicture {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
  type: "png" | "jpg";
}

export interface OutTableCell {
  paragraphs: OutParagraph[];
  columnSpan: number;
  rowSpan: number;
  continued: boolean;
}

export interface OutTable {
  x: number;
  y: number;
  width: number;
  height: number;
  columnWidths: number[];
  rowHeights: number[];
  rows: OutTableCell[][];
}

export interface OutSlide {
  texts: OutTextBox[];
  pictures: OutPicture[];
  tables: OutTable[];
}

function emu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

const ALIGN: Record<OutParagraph["align"], string> = {
  left: "l",
  center: "ctr",
  right: "r",
  justify: "just",
};

function runXml(run: OutRun): string {
  const color = run.color.replace("#", "").toUpperCase().padStart(6, "0").slice(0, 6);
  return (
    `<a:r><a:rPr lang="en-US" sz="${Math.max(100, Math.round(run.size * 100))}"` +
    `${run.bold ? ' b="1"' : ""}${run.italic ? ' i="1"' : ""} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr>` +
    `<a:t>${escapeXml(run.text)}</a:t></a:r>`
  );
}

function paragraphXml(paragraph: OutParagraph): string {
  const runs = paragraph.runs.map(runXml).join("");
  return `<a:p><a:pPr algn="${ALIGN[paragraph.align]}"/>${runs}</a:p>`;
}

/**
 * A text body, in whichever namespace its parent expects: a shape carries
 * `p:txBody`, while a table cell carries `a:txBody`. Getting this wrong
 * produces a file that opens perfectly well with no text in the table.
 */
function bodyXml(paragraphs: OutParagraph[], prefix: "p" | "a" = "p"): string {
  const content = paragraphs.length ? paragraphs.map(paragraphXml).join("") : "<a:p/>";
  return (
    `<${prefix}:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0">` +
    `<a:normAutofit/></a:bodyPr><a:lstStyle/>${content}</${prefix}:txBody>`
  );
}

function frameXml(x: number, y: number, width: number, height: number): string {
  return (
    `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/>` +
    `<a:ext cx="${emu(Math.max(1, width))}" cy="${emu(Math.max(1, height))}"/></a:xfrm>`
  );
}

function textBoxXml(box: OutTextBox, id: number): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/>` +
    `<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${frameXml(box.x, box.y, box.width, box.height)}` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `${bodyXml(box.paragraphs)}</p:sp>`
  );
}

function pictureXml(picture: OutPicture, id: number, relId: string): string {
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/>` +
    `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${frameXml(picture.x, picture.y, picture.width, picture.height)}` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function tableXml(table: OutTable, id: number): string {
  const grid = table.columnWidths
    .map((width) => `<a:gridCol w="${emu(width)}"/>`)
    .join("");

  const rows = table.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => {
          const span = cell.columnSpan > 1 ? ` gridSpan="${cell.columnSpan}"` : "";
          const rowSpan = cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : "";
          const merged = cell.continued ? ` hMerge="1"` : "";
          return (
            `<a:tc${span}${rowSpan}${merged}>${bodyXml(cell.paragraphs, "a")}` +
            `<a:tcPr marL="45720" marR="45720" marT="27432" marB="27432" anchor="t"/></a:tc>`
          );
        })
        .join("");
      return `<a:tr h="${emu(table.rowHeights[rowIndex] ?? 18)}">${cells}</a:tr>`;
    })
    .join("");

  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/>` +
    `<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${emu(table.x)}" y="${emu(table.y)}"/>` +
    `<a:ext cx="${emu(Math.max(1, table.width))}" cy="${emu(Math.max(1, table.height))}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function slideXml(slide: OutSlide, pictureRelIds: string[]): string {
  let id = 2;
  const shapes = [
    ...slide.pictures.map((picture, index) =>
      pictureXml(picture, id++, pictureRelIds[index])
    ),
    ...slide.tables.map((table) => tableXml(table, id++)),
    ...slide.texts.map((box) => textBoxXml(box, id++)),
  ].join("");

  return (
    `${XML_HEADER}<p:sld xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

const THEME = `${XML_HEADER}<a:theme xmlns:a="${A}" name="Office"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2>
<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;

function emptySpTree(): string {
  return (
    `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>` +
    `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`
  );
}

const SLIDE_MASTER =
  `${XML_HEADER}<p:sldMaster xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}">` +
  `<p:cSld>${emptySpTree()}</p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ` +
  `accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

const SLIDE_LAYOUT =
  `${XML_HEADER}<p:sldLayout xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}" type="blank" preserve="1">` +
  `<p:cSld name="Blank">${emptySpTree()}</p:cSld>` +
  `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export async function writePresentation(
  slides: OutSlide[],
  width: number,
  height: number
): Promise<Uint8Array> {
  const parts: Part[] = [];
  const slideRelIds: string[] = [];

  parts.push({
    path: "_rels/.rels",
    data: relationshipsXml([
      { id: "rId1", type: `${REL}/officeDocument`, target: "ppt/presentation.xml" },
    ]),
  });

  parts.push({
    path: "ppt/theme/theme1.xml",
    data: THEME,
    contentType: "application/vnd.openxmlformats-officedocument.theme+xml",
  });

  parts.push({
    path: "ppt/slideMasters/slideMaster1.xml",
    data: SLIDE_MASTER,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
  });
  parts.push({
    path: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    data: relationshipsXml([
      { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" },
    ]),
  });

  parts.push({
    path: "ppt/slideLayouts/slideLayout1.xml",
    data: SLIDE_LAYOUT,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
  });
  parts.push({
    path: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    data: relationshipsXml([
      { id: "rId1", type: `${REL}/slideMaster`, target: "../slideMasters/slideMaster1.xml" },
    ]),
  });

  let mediaCount = 0;
  slides.forEach((slide, index) => {
    const number = index + 1;
    const pictureRels: string[] = [];

    slide.pictures.forEach((picture) => {
      mediaCount += 1;
      const extension = picture.type === "png" ? "png" : "jpeg";
      const name = `image${mediaCount}.${extension}`;
      parts.push({ path: `ppt/media/${name}`, data: picture.data });
      pictureRels.push(name);
    });

    const relIds = pictureRels.map((_, i) => `rId${i + 2}`);
    parts.push({
      path: `ppt/slides/slide${number}.xml`,
      data: slideXml(slide, relIds),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    });
    parts.push({
      path: `ppt/slides/_rels/slide${number}.xml.rels`,
      data: relationshipsXml([
        { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
        ...pictureRels.map((name, i) => ({
          id: `rId${i + 2}`,
          type: `${REL}/image`,
          target: `../media/${name}`,
        })),
      ]),
    });

    slideRelIds.push(`rId${index + 2}`);
  });

  const presentation =
    `${XML_HEADER}<p:presentation xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${slides
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="${slideRelIds[index]}"/>`)
      .join("")}</p:sldIdLst>` +
    `<p:sldSz cx="${emu(width)}" cy="${emu(height)}"/>` +
    `<p:notesSz cx="${emu(height)}" cy="${emu(width)}"/></p:presentation>`;

  parts.push({
    path: "ppt/presentation.xml",
    data: presentation,
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  });
  parts.push({
    path: "ppt/_rels/presentation.xml.rels",
    data: relationshipsXml([
      { id: "rId1", type: `${REL}/slideMaster`, target: "slideMasters/slideMaster1.xml" },
      ...slides.map((_, index) => ({
        id: slideRelIds[index],
        type: `${REL}/slide`,
        target: `slides/slide${index + 1}.xml`,
      })),
    ]),
  });

  return createPackage(parts);
}
