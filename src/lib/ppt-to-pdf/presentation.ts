import { attr, descendants, emu, kid, kids, numAttr, parseXml } from "../office/xml";
import { decodeUtf8, openZip, type ZipFile } from "../office/zip";
import type {
  Picture,
  Presentation,
  RunFormat,
  Shape,
  ShapeTable,
  Slide,
  TableCell,
  TextBody,
  TextParagraph,
  TextRun,
} from "./types";
import { PowerPointError } from "./types";

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 540;
/** PowerPoint's own defaults when a run says nothing about its size. */
const TITLE_SIZE = 44;
const BODY_SIZE = 18;
const BULLETS = ["•", "–", "•", "–", "»", "•", "–", "»", "•"];

type ColorScheme = Record<string, string>;

interface Package {
  zip: ZipFile;
  scheme: ColorScheme;
  /** Maps the scheme names shapes use (bg1, tx1…) onto the theme's own. */
  colorMap: Record<string, string>;
}

async function readText(zip: ZipFile, path: string): Promise<string | undefined> {
  const data = await zip.read(path);
  return data ? decodeUtf8(data) : undefined;
}

/** Resolve "ppt/slides/slide1.xml" + "../media/image2.png" to a package path. */
function resolvePath(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

async function readRels(zip: ZipFile, partPath: string): Promise<Map<string, string>> {
  const parts = partPath.split("/");
  const relsPath = [...parts.slice(0, -1), "_rels", `${parts[parts.length - 1]}.rels`].join("/");
  const xml = await readText(zip, relsPath);
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of descendants(parseXml(xml).documentElement, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    if (id && target) map.set(id, resolvePath(partPath, target));
  }
  return map;
}

function applyLuminance(hex: string, mod: number | undefined, off: number | undefined): string {
  if (mod === undefined && off === undefined) return hex;
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    let level = channel / 255;
    if (mod !== undefined) level *= mod;
    if (off !== undefined) level += off;
    return Math.max(0, Math.min(255, Math.round(level * 255)));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function readColorElement(parent: Element | undefined, pkg: Package): string | undefined {
  if (!parent) return undefined;
  const srgb = kid(parent, "srgbClr");
  const scheme = kid(parent, "schemeClr");
  const source = srgb ?? scheme;
  if (!source) return undefined;

  let hex: string | undefined;
  if (srgb) {
    hex = `#${(attr(srgb, "val") ?? "000000").toUpperCase()}`;
  } else if (scheme) {
    const name = attr(scheme, "val") ?? "tx1";
    const mapped = pkg.colorMap[name] ?? name;
    hex = pkg.scheme[mapped] ?? pkg.scheme[name];
  }
  if (!hex) return undefined;

  const lumMod = numAttr(kid(source, "lumMod"), "val");
  const lumOff = numAttr(kid(source, "lumOff"), "val");
  return applyLuminance(
    hex,
    lumMod === undefined ? undefined : lumMod / 100000,
    lumOff === undefined ? undefined : lumOff / 100000
  );
}

function readFill(properties: Element | undefined, pkg: Package): string | undefined {
  const solid = kid(properties, "solidFill");
  if (solid) return readColorElement(solid, pkg);
  if (kid(properties, "noFill")) return undefined;
  return undefined;
}

function readLine(properties: Element | undefined, pkg: Package): { color: string; width: number } | undefined {
  const line = kid(properties, "ln");
  if (!line || kid(line, "noFill")) return undefined;
  const color = readColorElement(kid(line, "solidFill"), pkg);
  if (!color) return undefined;
  return { color, width: emu(numAttr(line, "w"), 1) || 1 };
}

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

function readFrame(properties: Element | undefined): Frame | undefined {
  const xfrm = kid(properties, "xfrm");
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!xfrm || !off || !ext) return undefined;
  return {
    x: emu(numAttr(off, "x")),
    y: emu(numAttr(off, "y")),
    width: emu(numAttr(ext, "cx")),
    height: emu(numAttr(ext, "cy")),
    rotation: (numAttr(xfrm, "rot") ?? 0) / 60000,
  };
}

function readRunFormat(
  properties: Element | undefined,
  pkg: Package,
  fallback: RunFormat
): RunFormat {
  const size = numAttr(properties, "sz");
  const latin = kid(properties, "latin");
  return {
    family: attr(latin, "typeface") ?? fallback.family,
    size: size !== undefined ? size / 100 : fallback.size,
    bold: attr(properties, "b") === "1" || (attr(properties, "b") === undefined && fallback.bold),
    italic: attr(properties, "i") === "1" || (attr(properties, "i") === undefined && fallback.italic),
    underline: (attr(properties, "u") ?? "none") !== "none",
    strike: (attr(properties, "strike") ?? "noStrike") !== "noStrike",
    color: readColorElement(kid(properties, "solidFill"), pkg) ?? fallback.color,
  };
}

/**
 * Read a text body.
 *
 * `bulleted` says whether this shape's paragraphs carry a bullet unless they
 * opt out — true for a body placeholder, which is where PowerPoint's master
 * list styles put one, and false for titles and free-standing text boxes.
 */
function readTextBody(
  body: Element | undefined,
  pkg: Package,
  fallback: RunFormat,
  bulleted = false,
  defaultAlign: TextParagraph["align"] = "left"
): TextBody | undefined {
  if (!body) return undefined;
  const bodyPr = kid(body, "bodyPr");
  const anchorValue = attr(bodyPr, "anchor");

  const paragraphs: TextParagraph[] = [];
  for (const p of kids(body)) {
    if (p.localName !== "p") continue;
    const pPr = kid(p, "pPr");
    const level = numAttr(pPr, "lvl") ?? 0;

    const runs: TextRun[] = [];
    for (const node of kids(p)) {
      if (node.localName === "r") {
        const text = kid(node, "t")?.textContent ?? "";
        if (!text) continue;
        runs.push({ text, format: readRunFormat(kid(node, "rPr"), pkg, fallback) });
      } else if (node.localName === "br") {
        runs.push({ text: "\n", format: fallback });
      } else if (node.localName === "fld") {
        const text = kid(node, "t")?.textContent ?? "";
        if (text) runs.push({ text, format: readRunFormat(kid(node, "rPr"), pkg, fallback) });
      }
    }

    const alignValue = attr(pPr, "algn");
    const spacing = kid(kid(pPr, "lnSpc"), "spcPct");
    const before = kid(kid(pPr, "spcBef"), "spcPts");
    const after = kid(kid(pPr, "spcAft"), "spcPts");

    // A bullet is on by default in a body placeholder and off when the
    // paragraph says buNone; the character itself steps by indent level.
    const noBullet = !!kid(pPr, "buNone");
    const bulletChar = kid(pPr, "buChar");
    const autoNumber = kid(pPr, "buAutoNum");

    paragraphs.push({
      runs,
      align:
        alignValue === "ctr" ? "center"
        : alignValue === "r" ? "right"
        : alignValue === "just" ? "justify"
        : alignValue === "l" ? "left"
        : defaultAlign,
      level,
      bullet: noBullet
        ? undefined
        : bulletChar
          ? attr(bulletChar, "char") ?? BULLETS[Math.min(level, 8)]
          : autoNumber
            ? `${paragraphs.length + 1}.`
            : bulleted
              ? BULLETS[Math.min(level, 8)]
              : undefined,
      spaceBefore: (numAttr(before, "val") ?? 0) / 100,
      spaceAfter: (numAttr(after, "val") ?? 0) / 100,
      lineSpacing: (numAttr(spacing, "val") ?? 100000) / 100000,
    });
  }

  if (paragraphs.length === 0) return undefined;

  return {
    paragraphs,
    anchor: anchorValue === "ctr" ? "center" : anchorValue === "b" ? "bottom" : "top",
    // PowerPoint's own defaults, in points: 0.1in across, 0.05in down.
    insets: {
      left: emu(numAttr(bodyPr, "lIns"), 7.2),
      top: emu(numAttr(bodyPr, "tIns"), 3.6),
      right: emu(numAttr(bodyPr, "rIns"), 7.2),
      bottom: emu(numAttr(bodyPr, "bIns"), 3.6),
    },
    wrap: attr(bodyPr, "wrap") !== "none",
  };
}

function imageType(path: string): "png" | "jpg" | undefined {
  if (/\.png$/i.test(path)) return "png";
  if (/\.jpe?g$/i.test(path)) return "jpg";
  return undefined;
}

async function readPicture(
  node: Element,
  rels: Map<string, string>,
  zip: ZipFile
): Promise<Picture | undefined> {
  const blip = kid(kid(node, "blipFill"), "blip");
  const id =
    blip?.getAttribute("r:embed") ??
    blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
  const path = id ? rels.get(id) : undefined;
  const type = path ? imageType(path) : undefined;
  if (!path || !type) return undefined;
  const data = await zip.read(path);
  return data ? { data, type } : undefined;
}

async function readTable(frame: Element, pkg: Package, fallback: RunFormat): Promise<ShapeTable | undefined> {
  const table = descendants(frame, "tbl")[0];
  if (!table) return undefined;

  const columns = descendants(kid(table, "tblGrid"), "gridCol").map((col) =>
    emu(numAttr(col, "w"))
  );

  const rows = descendants(table, "tr").map((tr) => {
    const cells: TableCell[] = [];
    for (const tc of kids(tr)) {
      if (tc.localName !== "tc") continue;
      const merged = attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1";
      cells.push({
        text: readTextBody(kid(tc, "txBody"), pkg, fallback),
        fill: readFill(kid(tc, "tcPr"), pkg),
        span: (numAttr(tc, "gridSpan") ?? 1),
        rowSpan: (numAttr(tc, "rowSpan") ?? 1),
        merged,
      });
    }
    return { height: emu(numAttr(tr, "h")), cells };
  });

  return columns.length > 0 && rows.length > 0 ? { columns, rows } : undefined;
}

/** How a group's child coordinates map into the group's own box. */
interface GroupTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

const IDENTITY: GroupTransform = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

function apply(frame: Frame, transform: GroupTransform): Frame {
  return {
    x: transform.offsetX + frame.x * transform.scaleX,
    y: transform.offsetY + frame.y * transform.scaleY,
    width: frame.width * transform.scaleX,
    height: frame.height * transform.scaleY,
    rotation: frame.rotation,
  };
}

interface Placeholders {
  frames: Map<string, Frame>;
  bodies: Map<string, TextBody>;
}

/** Index a layout or master's placeholders, so a slide can inherit position. */
function indexPlaceholders(root: Element | undefined, pkg: Package, fallback: RunFormat): Placeholders {
  const frames = new Map<string, Frame>();
  const bodies = new Map<string, TextBody>();
  if (!root) return { frames, bodies };

  for (const sp of descendants(root, "sp")) {
    const ph = descendants(kid(kid(sp, "nvSpPr"), "nvPr"), "ph")[0];
    if (!ph) continue;
    const type = attr(ph, "type") ?? "body";
    const index = attr(ph, "idx");
    const frame = readFrame(kid(sp, "spPr"));
    for (const key of [index ? `idx:${index}` : undefined, `type:${type}`]) {
      if (!key) continue;
      if (frame && !frames.has(key)) frames.set(key, frame);
      const body = readTextBody(kid(sp, "txBody"), pkg, fallback);
      if (body && !bodies.has(key)) bodies.set(key, body);
    }
  }
  return { frames, bodies };
}

function placeholderFrame(sp: Element, chain: Placeholders[]): Frame | undefined {
  const ph = descendants(kid(kid(sp, "nvSpPr"), "nvPr"), "ph")[0];
  if (!ph) return undefined;
  const index = attr(ph, "idx");
  const type = attr(ph, "type") ?? "body";
  for (const level of chain) {
    const found =
      (index ? level.frames.get(`idx:${index}`) : undefined) ?? level.frames.get(`type:${type}`);
    if (found) return found;
  }
  return undefined;
}

/**
 * A drawn shape is not a text box or a placeholder, and PowerPoint centres its
 * text by default — the file says so only by omission, since the default lives
 * in the application rather than the document.
 */
function isAutoShape(sp: Element): boolean {
  const ph = descendants(kid(kid(sp, "nvSpPr"), "nvPr"), "ph")[0];
  if (ph) return false;
  return attr(kid(kid(sp, "nvSpPr"), "cNvSpPr"), "txBox") !== "1";
}

/** Placeholder types whose paragraphs carry a bullet by default. */
const BULLETED_PLACEHOLDERS = new Set(["body", "obj"]);

function placeholderType(sp: Element): string | undefined {
  const ph = descendants(kid(kid(sp, "nvSpPr"), "nvPr"), "ph")[0];
  if (!ph) return undefined;
  // An untyped placeholder is a body placeholder.
  return attr(ph, "type") ?? "body";
}

async function readShapeTree(
  tree: Element,
  pkg: Package,
  rels: Map<string, string>,
  chain: Placeholders[],
  transform: GroupTransform,
  fallback: RunFormat,
  out: Shape[]
): Promise<void> {
  for (const node of kids(tree)) {
    const name = node.localName;

    if (name === "grpSp") {
      const groupFrame = readFrame(kid(node, "grpSpPr"));
      const xfrm = kid(kid(node, "grpSpPr"), "xfrm");
      const childOff = kid(xfrm, "chOff");
      const childExt = kid(xfrm, "chExt");
      let next = transform;
      if (groupFrame && childOff && childExt) {
        const placed = apply(groupFrame, transform);
        const childWidth = emu(numAttr(childExt, "cx")) || placed.width || 1;
        const childHeight = emu(numAttr(childExt, "cy")) || placed.height || 1;
        const scaleX = placed.width / childWidth;
        const scaleY = placed.height / childHeight;
        next = {
          scaleX,
          scaleY,
          offsetX: placed.x - emu(numAttr(childOff, "x")) * scaleX,
          offsetY: placed.y - emu(numAttr(childOff, "y")) * scaleY,
        };
      }
      await readShapeTree(node, pkg, rels, chain, next, fallback, out);
      continue;
    }

    if (name !== "sp" && name !== "pic" && name !== "graphicFrame") continue;

    const properties =
      name === "pic" ? kid(node, "spPr") : name === "sp" ? kid(node, "spPr") : kid(node, "xfrm");
    const own = name === "graphicFrame" ? readFrame(node) : readFrame(properties);
    const inherited = name === "sp" ? placeholderFrame(node, chain) : undefined;
    const frame = own ?? inherited;
    if (!frame) continue;

    const placed = apply(frame, transform);
    const placeholder = name === "sp" ? placeholderType(node) : undefined;
    const isTitle = placeholder === "title" || placeholder === "ctrTitle";
    const runFallback: RunFormat = {
      ...fallback,
      size: isTitle ? TITLE_SIZE : placeholder ? BODY_SIZE : fallback.size,
    };

    const shape: Shape = {
      x: placed.x,
      y: placed.y,
      width: placed.width,
      height: placed.height,
      rotation: placed.rotation,
      fill: name === "sp" ? readFill(properties, pkg) : undefined,
      line: name === "sp" ? readLine(properties, pkg) : undefined,
    };

    if (name === "pic") {
      shape.picture = await readPicture(node, rels, pkg.zip);
      if (!shape.picture) continue;
    } else if (name === "graphicFrame") {
      shape.table = await readTable(node, pkg, runFallback);
      if (!shape.table) continue;
    } else {
      shape.text = readTextBody(
        kid(node, "txBody"),
        pkg,
        runFallback,
        placeholder !== undefined && BULLETED_PLACEHOLDERS.has(placeholder),
        isAutoShape(node) ? "center" : "left"
      );
      if (!shape.text && !shape.fill && !shape.line) continue;
    }

    out.push(shape);
  }
}

function readColorScheme(themeXml: string | undefined): ColorScheme {
  const scheme: ColorScheme = {
    dk1: "#000000", lt1: "#FFFFFF", dk2: "#44546A", lt2: "#E7E6E6",
    accent1: "#4472C4", accent2: "#ED7D31", accent3: "#A5A5A5",
    accent4: "#FFC000", accent5: "#5B9BD5", accent6: "#70AD47",
    hlink: "#0563C1", folHlink: "#954F72",
  };
  if (!themeXml) return scheme;
  const clrScheme = descendants(parseXml(themeXml).documentElement, "clrScheme")[0];
  for (const entry of kids(clrScheme)) {
    const srgb = kid(entry, "srgbClr");
    const sys = kid(entry, "sysClr");
    const hex = srgb
      ? `#${(attr(srgb, "val") ?? "").toUpperCase()}`
      : sys
        ? `#${(attr(sys, "lastClr") ?? "").toUpperCase()}`
        : undefined;
    if (hex && hex.length === 7) scheme[entry.localName] = hex;
  }
  return scheme;
}

export async function readPresentation(buffer: ArrayBuffer): Promise<Presentation> {
  let zip: ZipFile;
  try {
    zip = await openZip(buffer);
  } catch {
    throw new PowerPointError("This file is not a readable .pptx presentation.");
  }

  const presentationXml = await readText(zip, "ppt/presentation.xml");
  if (!presentationXml) {
    throw new PowerPointError("This file is not a readable .pptx presentation.");
  }

  const root = parseXml(presentationXml).documentElement;
  const size = kid(root, "sldSz");
  const width = emu(numAttr(size, "cx")) || DEFAULT_WIDTH;
  const height = emu(numAttr(size, "cy")) || DEFAULT_HEIGHT;

  const rels = await readRels(zip, "ppt/presentation.xml");
  const slidePaths: string[] = [];
  for (const entry of descendants(kid(root, "sldIdLst"), "sldId")) {
    const id =
      entry.getAttribute("r:id") ??
      entry.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const path = id ? rels.get(id) : undefined;
    if (path) slidePaths.push(path);
  }
  if (slidePaths.length === 0) throw new PowerPointError("This presentation has no slides.");

  const slides: Slide[] = [];

  for (const slidePath of slidePaths) {
    const slideXml = await readText(zip, slidePath);
    if (!slideXml) continue;
    const slideRoot = parseXml(slideXml).documentElement;
    const slideRels = await readRels(zip, slidePath);

    // The layout and master behind this slide supply its theme, its colour
    // map, and the position of any placeholder the slide leaves unspecified.
    const layoutPath = [...slideRels.values()].find((p) => p.includes("slideLayouts/"));
    const layoutXml = layoutPath ? await readText(zip, layoutPath) : undefined;
    const layoutRels = layoutPath ? await readRels(zip, layoutPath) : new Map<string, string>();
    const masterPath = [...layoutRels.values()].find((p) => p.includes("slideMasters/"));
    const masterXml = masterPath ? await readText(zip, masterPath) : undefined;
    const masterRels = masterPath ? await readRels(zip, masterPath) : new Map<string, string>();
    const themePath = [...masterRels.values()].find((p) => p.includes("theme/"));

    const scheme = readColorScheme(themePath ? await readText(zip, themePath) : undefined);
    const masterRoot = masterXml ? parseXml(masterXml).documentElement : undefined;
    const colorMap: Record<string, string> = {};
    const clrMap = kid(masterRoot, "clrMap");
    if (clrMap) {
      for (const attribute of Array.from(clrMap.attributes)) {
        colorMap[attribute.name.replace(/^.*:/, "")] = attribute.value;
      }
    }

    const pkg: Package = { zip, scheme, colorMap };
    const fallback: RunFormat = {
      family: "Calibri",
      size: BODY_SIZE,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      color: scheme[colorMap.tx1 ?? "dk1"] ?? "#000000",
    };

    const layoutRoot = layoutXml ? parseXml(layoutXml).documentElement : undefined;
    const chain = [
      indexPlaceholders(layoutRoot, pkg, fallback),
      indexPlaceholders(masterRoot, pkg, fallback),
    ];

    const shapes: Shape[] = [];
    const tree = descendants(slideRoot, "spTree")[0];
    if (tree) {
      await readShapeTree(tree, pkg, slideRels, chain, IDENTITY, fallback, shapes);
    }

    const background =
      readColorElement(kid(kid(kid(slideRoot, "cSld"), "bg"), "bgPr"), pkg) ??
      readFill(kid(kid(kid(slideRoot, "cSld"), "bg"), "bgPr"), pkg) ??
      readFill(kid(kid(kid(layoutRoot, "cSld"), "bg"), "bgPr"), pkg) ??
      readFill(kid(kid(kid(masterRoot, "cSld"), "bg"), "bgPr"), pkg);

    slides.push({ shapes, background });
  }

  if (slides.length === 0) throw new PowerPointError("This presentation has no readable slides.");
  return { width, height, slides };
}
