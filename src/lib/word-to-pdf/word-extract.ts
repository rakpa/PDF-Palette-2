import type {
  Align,
  Block,
  Borders,
  BorderEdge,
  ImageItem,
  Inline,
  ParagraphBlock,
  RunStyle,
  Section,
  TableBlock,
  TableCellBlock,
  TableRowBlock,
  WordDocument,
} from "./types";
import { decodeUtf8, openZip, type ZipFile } from "./zip";
import {
  attr,
  descendants,
  emu,
  halfPt,
  kid,
  kids,
  numAttr,
  numVal,
  parseXml,
  twip,
  val,
} from "./xml";

const LETTER_W = 612;
const LETTER_H = 792;
const DEFAULT_MARGIN = 72;
const DEFAULT_FONT: RunStyle = {
  family: "Calibri",
  fontSize: 11,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "000000",
};

type Rel = { type: string; target: string; external: boolean };

type ParaProps = {
  align: Align;
  indentLeft: number;
  indentRight: number;
  indentFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  line: number;
  lineExact: boolean;
  styleId?: string;
  numId?: number;
  ilvl?: number;
  run: RunStyle;
};

type StyleDef = {
  basedOn?: string;
  para?: Partial<ParaProps>;
  run?: Partial<RunStyle>;
};

type NumLevel = {
  fmt: string;
  text: string;
  indentLeft: number;
  hanging: number;
  run?: Partial<RunStyle>;
};

type ExtractContext = {
  zip: ZipFile;
  rels: Map<string, Rel>;
  styles: Map<string, StyleDef>;
  docDefaults: { para: ParaProps; run: RunStyle };
  theme: { major: string; minor: string };
  abstractNums: Map<string, Map<number, NumLevel>>;
  numMap: Map<string, string>;
  counters: Map<string, number[]>;
  media: Map<string, ImageItem>;
  headerCache: Map<string, Block[]>;
};

function cloneRun(style: RunStyle): RunStyle {
  return { ...style };
}

function defaultPara(run: RunStyle): ParaProps {
  return {
    align: "left",
    indentLeft: 0,
    indentRight: 0,
    indentFirst: 0,
    spaceBefore: 0,
    spaceAfter: 8,
    line: 276,
    lineExact: false,
    run,
  };
}

function parseAlign(value: string | undefined, fallback: Align): Align {
  switch (value) {
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "distribute":
      return "justify";
    case "left":
    case "start":
      return "left";
    default:
      return fallback;
  }
}

function parseColor(value: string | undefined, fallback: string): string {
  if (!value || value === "auto") return fallback;
  const hex = value.replace("#", "").toUpperCase();
  if (/^[0-9A-F]{6}$/.test(hex)) return hex;
  if (/^[0-9A-F]{3}$/.test(hex)) {
    return hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return fallback;
}

function onOff(el: Element | undefined): boolean | undefined {
  if (!el) return undefined;
  const v = val(el);
  if (v == null) return true;
  return v !== "0" && v !== "false" && v !== "off";
}

function applyRPr(base: RunStyle, rPr: Element | undefined, theme: ExtractContext["theme"]): RunStyle {
  if (!rPr) return cloneRun(base);
  const next = cloneRun(base);
  const fonts = kid(rPr, "rFonts");
  const ascii = attr(fonts, "ascii") || attr(fonts, "hAnsi");
  const themeFont = attr(fonts, "asciiTheme") || attr(fonts, "hAnsiTheme");
  if (ascii) next.family = ascii;
  else if (themeFont) {
    next.family = /major/i.test(themeFont) ? theme.major : theme.minor;
  }
  const sz = kid(rPr, "szCs") ? numVal(kid(rPr, "sz")) ?? numVal(kid(rPr, "szCs")) : numVal(kid(rPr, "sz"));
  if (sz != null) next.fontSize = halfPt(sz, next.fontSize);
  const bold = onOff(kid(rPr, "b"));
  if (bold != null) next.bold = bold;
  const italic = onOff(kid(rPr, "i"));
  if (italic != null) next.italic = italic;
  const strike = onOff(kid(rPr, "strike")) ?? onOff(kid(rPr, "dstrike"));
  if (strike != null) next.strike = strike;
  const u = kid(rPr, "u");
  if (u) next.underline = val(u) !== "none";
  const color = val(kid(rPr, "color"));
  if (color) next.color = parseColor(color, next.color);
  const vert = val(kid(rPr, "vertAlign"));
  if (vert === "superscript") next.vertAlign = "super";
  else if (vert === "subscript") next.vertAlign = "sub";
  else if (vert === "baseline") next.vertAlign = undefined;
  const vanish = onOff(kid(rPr, "vanish")) ?? onOff(kid(rPr, "specVanish"));
  if (vanish) next.fontSize = 0;
  return next;
}

function applyPPr(base: ParaProps, pPr: Element | undefined, theme: ExtractContext["theme"]): ParaProps {
  if (!pPr) return { ...base, run: cloneRun(base.run) };
  const next: ParaProps = { ...base, run: applyRPr(base.run, kid(pPr, "rPr"), theme) };
  const styleId = val(kid(pPr, "pStyle"));
  if (styleId) next.styleId = styleId;
  next.align = parseAlign(val(kid(pPr, "jc")), next.align);
  const ind = kid(pPr, "ind");
  if (ind) {
    const left = numAttr(ind, "left") ?? numAttr(ind, "start");
    const right = numAttr(ind, "right") ?? numAttr(ind, "end");
    const first = numAttr(ind, "firstLine");
    const hanging = numAttr(ind, "hanging");
    if (left != null) next.indentLeft = twip(left);
    if (right != null) next.indentRight = twip(right);
    if (hanging != null) next.indentFirst = -twip(hanging);
    else if (first != null) next.indentFirst = twip(first);
  }
  const spacing = kid(pPr, "spacing");
  if (spacing) {
    const before = numAttr(spacing, "before");
    const after = numAttr(spacing, "after");
    const line = numAttr(spacing, "line");
    const rule = attr(spacing, "lineRule");
    if (before != null) next.spaceBefore = twip(before);
    if (after != null) next.spaceAfter = twip(after);
    if (line != null) {
      next.line = line;
      next.lineExact = rule === "exact" || rule === "atLeast";
    }
  }
  const numPr = kid(pPr, "numPr");
  if (numPr) {
    const id = numVal(kid(numPr, "numId"));
    const ilvl = numVal(kid(numPr, "ilvl"));
    if (id != null) next.numId = id;
    if (ilvl != null) next.ilvl = ilvl;
  }
  return next;
}

function resolveStyle(ctx: ExtractContext, styleId: string | undefined): { para: ParaProps; run: RunStyle } {
  let para = { ...ctx.docDefaults.para, run: cloneRun(ctx.docDefaults.run) };
  let run = cloneRun(ctx.docDefaults.run);
  if (!styleId) return { para, run };
  const chain: StyleDef[] = [];
  let current: string | undefined = styleId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const def = ctx.styles.get(current);
    if (!def) break;
    chain.push(def);
    current = def.basedOn;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const def = chain[i];
    if (def.para) para = { ...para, ...def.para, run: { ...para.run, ...(def.para.run ?? {}) } };
    if (def.run) run = { ...run, ...def.run };
  }
  para.run = { ...run, ...para.run };
  return { para, run };
}

function parseRels(xml: string | undefined, baseDir: string): Map<string, Rel> {
  const map = new Map<string, Rel>();
  if (!xml) return map;
  const doc = parseXml(xml);
  for (const rel of descendants(doc.documentElement, "Relationship")) {
    const id = attr(rel, "Id");
    const target = attr(rel, "Target");
    const type = attr(rel, "Type") ?? "";
    if (!id || !target) continue;
    const external = (attr(rel, "TargetMode") ?? "").toLowerCase() === "external";
    const resolved = external ? target : joinPath(baseDir, target);
    map.set(id, { type, target: resolved, external });
  }
  return map;
}

function joinPath(base: string, target: string): string {
  const cleaned = target.replace(/\\/g, "/");
  if (!base) return cleaned.replace(/^\.\//, "");
  const parts = [...base.split("/").filter(Boolean), ...cleaned.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function parseTheme(xml: string | undefined): { major: string; minor: string } {
  const fallback = { major: "Calibri Light", minor: "Calibri" };
  if (!xml) return fallback;
  const doc = parseXml(xml);
  const latin = descendants(doc.documentElement, "latin");
  const major = attr(latin[0], "typeface");
  const minor = attr(latin[1], "typeface") ?? attr(latin[0], "typeface");
  return {
    major: major || fallback.major,
    minor: minor || fallback.minor,
  };
}

function parseStyles(xml: string | undefined, theme: ExtractContext["theme"]): ExtractContext["styles"] & {
  defaults: { para: ParaProps; run: RunStyle };
} {
  const styles = new Map<string, StyleDef>();
  let run = cloneRun(DEFAULT_FONT);
  run.family = theme.minor;
  let para = defaultPara(run);
  if (!xml) return Object.assign(styles, { defaults: { para, run } });
  const doc = parseXml(xml);
  const defaults = kid(doc.documentElement, "docDefaults");
  if (defaults) {
    run = applyRPr(run, kid(kid(defaults, "rPrDefault"), "rPr"), theme);
    para = applyPPr({ ...defaultPara(run), run }, kid(kid(defaults, "pPrDefault"), "pPr"), theme);
  }
  for (const style of descendants(doc.documentElement, "style")) {
    const id = attr(style, "styleId");
    if (!id) continue;
    styles.set(id, {
      basedOn: val(kid(style, "basedOn")),
      para: applyPPr(defaultPara(run), kid(style, "pPr"), theme),
      run: applyRPr(run, kid(style, "rPr"), theme),
    });
  }
  return Object.assign(styles, { defaults: { para, run } });
}

function parseNumbering(xml: string | undefined): {
  abstractNums: Map<string, Map<number, NumLevel>>;
  numMap: Map<string, string>;
} {
  const abstractNums = new Map<string, Map<number, NumLevel>>();
  const numMap = new Map<string, string>();
  if (!xml) return { abstractNums, numMap };
  const doc = parseXml(xml);
  for (const abs of descendants(doc.documentElement, "abstractNum")) {
    const id = attr(abs, "abstractNumId");
    if (id == null) continue;
    const levels = new Map<number, NumLevel>();
    for (const lvl of kids(abs).filter((el) => el.localName === "lvl")) {
      const ilvl = numAttr(lvl, "ilvl") ?? 0;
      const ind = kid(kid(lvl, "pPr"), "ind");
      levels.set(ilvl, {
        fmt: val(kid(lvl, "numFmt")) ?? "decimal",
        text: val(kid(lvl, "lvlText")) ?? "%1.",
        indentLeft: twip(numAttr(ind, "left") ?? numAttr(ind, "start")),
        hanging: twip(numAttr(ind, "hanging")),
      });
    }
    abstractNums.set(id, levels);
  }
  for (const num of descendants(doc.documentElement, "num")) {
    const id = attr(num, "numId");
    const abs = val(kid(num, "abstractNumId"));
    if (id != null && abs != null) numMap.set(id, abs);
  }
  return { abstractNums, numMap };
}

function roman(n: number, upper: boolean): string {
  const pairs: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let rest = Math.max(1, n);
  let out = "";
  for (const [value, glyph] of pairs) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return upper ? out.toUpperCase() : out;
}

function letters(n: number, upper: boolean): string {
  let rest = Math.max(1, n);
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode((upper ? 65 : 97) + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function formatNum(fmt: string, n: number): string {
  switch (fmt) {
    case "lowerLetter":
      return letters(n, false);
    case "upperLetter":
      return letters(n, true);
    case "lowerRoman":
      return roman(n, false);
    case "upperRoman":
      return roman(n, true);
    case "bullet":
    case "none":
      return "";
    default:
      return String(n);
  }
}

function numberingText(ctx: ExtractContext, numId: number, ilvl: number): string | undefined {
  const absId = ctx.numMap.get(String(numId));
  if (!absId) return undefined;
  const levels = ctx.abstractNums.get(absId);
  if (!levels) return undefined;
  const key = String(numId);
  let counters = ctx.counters.get(key);
  if (!counters) {
    counters = [];
    ctx.counters.set(key, counters);
  }
  counters[ilvl] = (counters[ilvl] ?? 0) + 1;
  for (let i = ilvl + 1; i < counters.length; i++) counters[i] = 0;
  const level = levels.get(ilvl);
  if (!level) return undefined;
  if (level.fmt === "bullet") return level.text.replace(/%\d/g, "").trim() || "•";
  return level.text.replace(/%(\d)/g, (_, raw: string) => {
    const idx = Number(raw) - 1;
    const fmt = levels.get(idx)?.fmt ?? "decimal";
    const n = counters![idx] ?? 1;
    return formatNum(fmt, n) || "•";
  });
}

function detectImage(data: Uint8Array): "png" | "jpg" | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8) return "jpg";
  return null;
}

async function loadImage(ctx: ExtractContext, relId: string | undefined, width: number, height: number): Promise<ImageItem | undefined> {
  if (!relId) return undefined;
  const cached = ctx.media.get(relId);
  if (cached) {
    const scale = cached.width ? width / cached.width : 1;
    return {
      ...cached,
      width,
      height: height || cached.height * scale,
    };
  }
  const rel = ctx.rels.get(relId);
  if (!rel || rel.external) return undefined;
  const data = await ctx.zip.read(rel.target);
  if (!data) return undefined;
  const type = detectImage(data);
  if (!type) return undefined;
  const image: ImageItem = { kind: "image", data, type, width, height };
  ctx.media.set(relId, image);
  return image;
}

function drawingSize(drawing: Element): { width: number; height: number } {
  const extent = descendants(drawing, "extent")[0];
  const cx = numAttr(extent, "cx");
  const cy = numAttr(extent, "cy");
  let width = emu(cx);
  let height = emu(cy);
  const extentCx = descendants(drawing, "ext")[0];
  if (!width) width = emu(numAttr(extentCx, "cx"));
  if (!height) height = emu(numAttr(extentCx, "cy"));
  if (!width) width = 120;
  if (!height) height = 80;
  return { width, height };
}

async function parseDrawing(drawing: Element, ctx: ExtractContext): Promise<ImageItem | undefined> {
  const blip = descendants(drawing, "blip")[0];
  const relId = attr(blip, "embed") ?? attr(blip, "link");
  const { width, height } = drawingSize(drawing);
  return loadImage(ctx, relId, width, height);
}

async function parseVml(pict: Element, ctx: ExtractContext): Promise<ImageItem | undefined> {
  const data = descendants(pict, "imagedata")[0];
  const relId = attr(data, "id") ?? attr(data, "relid");
  const style = attr(descendants(pict, "shape")[0] ?? pict, "style") ?? "";
  const w = /width:([0-9.]+)pt/i.exec(style);
  const h = /height:([0-9.]+)pt/i.exec(style);
  return loadImage(ctx, relId, w ? Number(w[1]) : 120, h ? Number(h[1]) : 80);
}

async function parseRun(r: Element, inherited: RunStyle, ctx: ExtractContext): Promise<Inline[]> {
  const style = applyRPr(inherited, kid(r, "rPr"), ctx.theme);
  if (style.fontSize === 0) return [];
  const out: Inline[] = [];
  for (const child of kids(r)) {
    switch (child.localName) {
      case "rPr":
        break;
      case "t":
        out.push({ kind: "text", text: child.textContent ?? "", style });
        break;
      case "tab":
        out.push({ kind: "tab" });
        break;
      case "br":
      case "cr": {
        const type = attr(child, "type");
        out.push({ kind: "break", break: type === "page" || type === "column" ? "page" : "line" });
        break;
      }
      case "drawing": {
        const image = await parseDrawing(child, ctx);
        if (image) out.push(image);
        break;
      }
      case "pict":
      case "object": {
        const image = await parseVml(child, ctx);
        if (image) out.push(image);
        break;
      }
      case "sym": {
        const hex = attr(child, "char");
        if (hex) {
          const code = Number.parseInt(hex, 16);
          if (Number.isFinite(code)) out.push({ kind: "text", text: String.fromCodePoint(code), style });
        }
        break;
      }
      case "noBreakHyphen":
        out.push({ kind: "text", text: "-", style });
        break;
      default:
        break;
    }
  }
  return out;
}

async function walkInline(el: Element, inherited: RunStyle, ctx: ExtractContext, out: Inline[]): Promise<void> {
  for (const child of kids(el)) {
    switch (child.localName) {
      case "pPr":
      case "bookmarkStart":
      case "bookmarkEnd":
      case "proofErr":
      case "commentRangeStart":
      case "commentRangeEnd":
      case "del":
        break;
      case "r":
        out.push(...(await parseRun(child, inherited, ctx)));
        break;
      case "hyperlink": {
        const relId = attr(child, "id");
        const rel = relId ? ctx.rels.get(relId) : undefined;
        const href = rel?.external ? rel.target : attr(child, "anchor");
        const inner: Inline[] = [];
        await walkInline(child, inherited, ctx, inner);
        for (const item of inner) {
          if (item.kind === "text" && href) item.link = href;
          out.push(item);
        }
        break;
      }
      case "sdt": {
        const content = kid(child, "sdtContent");
        if (content) await walkInline(content, inherited, ctx, out);
        break;
      }
      case "ins":
      case "smartTag":
      case "ruby":
      case "fldSimple":
        await walkInline(child, inherited, ctx, out);
        break;
      case "hyperlinkPr":
        break;
      default:
        if (kids(child).length) await walkInline(child, inherited, ctx, out);
        break;
    }
  }
}

function parseBorderEdge(el: Element | undefined): BorderEdge | undefined {
  if (!el) return undefined;
  const valName = val(el);
  if (!valName || valName === "nil" || valName === "none") return undefined;
  const sz = numAttr(el, "sz") ?? 4;
  return {
    color: parseColor(attr(el, "color"), "000000"),
    width: Math.max(0.25, sz / 8),
  };
}

function parseBorders(el: Element | undefined): Borders {
  if (!el) return {};
  return {
    top: parseBorderEdge(kid(el, "top")),
    right: parseBorderEdge(kid(el, "right")),
    bottom: parseBorderEdge(kid(el, "bottom")),
    left: parseBorderEdge(kid(el, "left")),
    insideH: parseBorderEdge(kid(el, "insideH")),
    insideV: parseBorderEdge(kid(el, "insideV")),
  };
}

function mergeBorders(base: Borders, over: Borders): Borders {
  return {
    top: over.top ?? base.top,
    right: over.right ?? base.right,
    bottom: over.bottom ?? base.bottom,
    left: over.left ?? base.left,
    insideH: over.insideH ?? base.insideH,
    insideV: over.insideV ?? base.insideV,
  };
}

async function parseParagraph(p: Element, ctx: ExtractContext): Promise<ParagraphBlock> {
  const pPr = kid(p, "pPr");
  const styleId = val(kid(pPr, "pStyle"));
  const resolved = resolveStyle(ctx, styleId);
  let props = applyPPr({ ...resolved.para, run: { ...resolved.run, ...resolved.para.run } }, pPr, ctx.theme);
  let numbering: ParagraphBlock["numbering"];
  if (props.numId != null && props.numId !== 0) {
    const ilvl = props.ilvl ?? 0;
    const absId = ctx.numMap.get(String(props.numId));
    const level = absId ? ctx.abstractNums.get(absId)?.get(ilvl) : undefined;
    if (level) {
      if (!kid(pPr, "ind")) {
        props.indentLeft = level.indentLeft || props.indentLeft;
        props.indentFirst = level.hanging ? -level.hanging : props.indentFirst;
      }
      const text = numberingText(ctx, props.numId, ilvl);
      if (text) numbering = { text, width: Math.max(12, level.hanging || 18) };
    }
  }
  const runs: Inline[] = [];
  await walkInline(p, props.run, ctx, runs);
  return {
    kind: "paragraph",
    align: props.align,
    indentLeft: props.indentLeft,
    indentRight: props.indentRight,
    indentFirst: props.indentFirst,
    spaceBefore: props.spaceBefore,
    spaceAfter: props.spaceAfter,
    line: props.line,
    lineExact: props.lineExact,
    numbering,
    runs,
  };
}

async function parseCell(tc: Element, colWidth: number, tableBorders: Borders, ctx: ExtractContext): Promise<TableCellBlock> {
  const tcPr = kid(tc, "tcPr");
  const span = numVal(kid(tcPr, "gridSpan")) ?? 1;
  const mergeEl = kid(tcPr, "vMerge");
  let vMerge: TableCellBlock["vMerge"];
    if (mergeEl) vMerge = val(mergeEl) === "restart" ? "restart" : "continue";
  const width = twip(numAttr(kid(tcPr, "tcW"), "w"), colWidth);
  const shading = parseColor(attr(kid(tcPr, "shd"), "fill"), "") || undefined;
  const vAlignRaw = val(kid(tcPr, "vAlign"));
  const valign = vAlignRaw === "center" || vAlignRaw === "bottom" ? vAlignRaw : "top";
  const blocks: Block[] = [];
  for (const child of kids(tc)) {
    if (child.localName === "tcPr") continue;
    if (child.localName === "p") blocks.push(await parseParagraph(child, ctx));
    else if (child.localName === "tbl") blocks.push(await parseTable(child, ctx));
    else if (child.localName === "sdt") {
      const content = kid(child, "sdtContent");
      if (content) {
        for (const nested of kids(content)) {
          if (nested.localName === "p") blocks.push(await parseParagraph(nested, ctx));
          if (nested.localName === "tbl") blocks.push(await parseTable(nested, ctx));
        }
      }
    }
  }
  return {
    span,
    vMerge: vMerge === "continue" ? "continue" : vMerge,
    shading,
    borders: mergeBorders(tableBorders, parseBorders(kid(tcPr, "tcBorders"))),
    valign,
    width: width || colWidth,
    blocks,
  };
}

async function parseTable(tbl: Element, ctx: ExtractContext): Promise<TableBlock> {
  const tblPr = kid(tbl, "tblPr");
  const borders = parseBorders(kid(tblPr, "tblBorders"));
  if (!borders.top && !borders.left && !borders.insideH) {
    const fallback: BorderEdge = { color: "000000", width: 0.5 };
    borders.top = borders.right = borders.bottom = borders.left = borders.insideH = borders.insideV = fallback;
  }
  const grid = kid(tbl, "tblGrid");
  const cols = grid
    ? kids(grid)
        .filter((el) => el.localName === "gridCol")
        .map((el) => twip(numAttr(el, "w"), 80))
    : [];
  const indent = twip(numAttr(kid(kid(tblPr, "tblInd"), "tblInd") ?? kid(tblPr, "tblInd"), "w"));
  const tableWidth = twip(numAttr(kid(tblPr, "tblW"), "w"), cols.reduce((a, b) => a + b, 0));
  const rows: TableRowBlock[] = [];
  for (const tr of kids(tbl).filter((el) => el.localName === "tr")) {
    const trPr = kid(tr, "trPr");
    const header = Boolean(kid(trPr, "tblHeader"));
    const height = twip(numAttr(kid(trPr, "trHeight"), "val"));
    const cells: TableCellBlock[] = [];
    let col = 0;
    for (const tc of kids(tr).filter((el) => el.localName === "tc")) {
      const span = numVal(kid(kid(tc, "tcPr"), "gridSpan")) ?? 1;
      let width = 0;
      for (let i = 0; i < span; i++) width += cols[col + i] ?? 80;
      cells.push(await parseCell(tc, width, borders, ctx));
      col += span;
    }
    rows.push({ cells, height: height || undefined, header });
  }
  return {
    kind: "table",
    rows,
    width: tableWidth || cols.reduce((a, b) => a + b, 0),
    indent,
    borders,
  };
}

async function parseBlocks(parent: Element, ctx: ExtractContext): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const child of kids(parent)) {
    if (child.localName === "p") blocks.push(await parseParagraph(child, ctx));
    else if (child.localName === "tbl") blocks.push(await parseTable(child, ctx));
    else if (child.localName === "sdt") {
      const content = kid(child, "sdtContent");
      if (content) blocks.push(...(await parseBlocks(content, ctx)));
    }
  }
  return blocks;
}

function parseSectPr(sectPr: Element | undefined): Pick<Section, "width" | "height" | "margins" | "headerDistance" | "footerDistance"> {
  const pgSz = kid(sectPr, "pgSz");
  const orient = attr(pgSz, "orient");
  let width = twip(numAttr(pgSz, "w"), LETTER_W);
  let height = twip(numAttr(pgSz, "h"), LETTER_H);
  if (orient === "landscape" && width < height) [width, height] = [height, width];
  const pgMar = kid(sectPr, "pgMar");
  return {
    width,
    height,
    margins: {
      top: twip(numAttr(pgMar, "top"), DEFAULT_MARGIN),
      right: twip(numAttr(pgMar, "right"), DEFAULT_MARGIN),
      bottom: twip(numAttr(pgMar, "bottom"), DEFAULT_MARGIN),
      left: twip(numAttr(pgMar, "left"), DEFAULT_MARGIN),
    },
    headerDistance: twip(numAttr(pgMar, "header"), 36),
    footerDistance: twip(numAttr(pgMar, "footer"), 36),
  };
}

async function loadStory(ctx: ExtractContext, path: string | undefined): Promise<Block[]> {
  if (!path) return [];
  if (ctx.headerCache.has(path)) return ctx.headerCache.get(path)!;
  const data = await ctx.zip.read(path);
  if (!data) return [];
  const xml = decodeUtf8(data);
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const relsPath = path.replace(/^(.*)\/([^/]+)$/, "$1/_rels/$2.rels");
  const nestedRels = parseRels(await readText(ctx.zip, relsPath), path.replace(/\/[^/]+$/, ""));
  const prev = ctx.rels;
  const merged = new Map(prev);
  for (const [k, v] of nestedRels) merged.set(k, v);
  ctx.rels = merged;
  const blocks = await parseBlocks(root, ctx);
  ctx.rels = prev;
  ctx.headerCache.set(path, blocks);
  return blocks;
}

function headerRef(sectPr: Element | undefined, kind: "header" | "footer"): string | undefined {
  if (!sectPr) return undefined;
  const name = kind === "header" ? "headerReference" : "footerReference";
  const refs = kids(sectPr).filter((el) => el.localName === name);
  const preferred = refs.find((el) => attr(el, "type") === "default") ?? refs[0];
  return attr(preferred, "id");
}

async function readText(zip: ZipFile, path: string): Promise<string | undefined> {
  const data = await zip.read(path);
  return data ? decodeUtf8(data) : undefined;
}

async function parseBody(ctx: ExtractContext, body: Element): Promise<Section[]> {
  type Bucket = { blocks: Block[]; sectPr?: Element };
  const buckets: Bucket[] = [];
  let current: Block[] = [];

  const flush = (sectPr?: Element) => {
    buckets.push({ blocks: current, sectPr });
    current = [];
  };

  for (const child of kids(body)) {
    if (child.localName === "p") {
      const sectPr = kid(kid(child, "pPr"), "sectPr");
      current.push(await parseParagraph(child, ctx));
      if (sectPr) flush(sectPr);
    } else if (child.localName === "tbl") {
      current.push(await parseTable(child, ctx));
    } else if (child.localName === "sdt") {
      const content = kid(child, "sdtContent");
      if (content) current.push(...(await parseBlocks(content, ctx)));
    } else if (child.localName === "sectPr") {
      flush(child);
    }
  }
  if (current.length) flush(undefined);

  if (buckets.length === 0) buckets.push({ blocks: [] });

  const sections: Section[] = [];
  for (const bucket of buckets) {
    const geom = parseSectPr(bucket.sectPr);
    const headerId = headerRef(bucket.sectPr, "header");
    const footerId = headerRef(bucket.sectPr, "footer");
    sections.push({
      ...geom,
      header: await loadStory(ctx, headerId ? ctx.rels.get(headerId)?.target : undefined),
      footer: await loadStory(ctx, footerId ? ctx.rels.get(footerId)?.target : undefined),
      body: bucket.blocks,
    });
  }
  return sections;
}

export async function extractWordDocument(buffer: ArrayBuffer): Promise<WordDocument> {
  const zip = await openZip(buffer);
  const documentXml = await zip.read("word/document.xml");
  if (!documentXml) {
    throw new Error("This file is not a .docx document (missing word/document.xml).");
  }

  const theme = parseTheme(await readText(zip, "word/theme/theme1.xml"));
  const stylePack = parseStyles(await readText(zip, "word/styles.xml"), theme);
  const numbering = parseNumbering(await readText(zip, "word/numbering.xml"));
  const rels = parseRels(await readText(zip, "word/_rels/document.xml.rels"), "word");

  const ctx: ExtractContext = {
    zip,
    rels,
    styles: stylePack,
    docDefaults: stylePack.defaults,
    theme,
    abstractNums: numbering.abstractNums,
    numMap: numbering.numMap,
    counters: new Map(),
    media: new Map(),
    headerCache: new Map(),
  };

  const doc = parseXml(decodeUtf8(documentXml));
  const body = kid(doc.documentElement, "body");
  if (!body) throw new Error("The Word document has no body.");
  const sections = await parseBody(ctx, body);
  return { sections };
}
