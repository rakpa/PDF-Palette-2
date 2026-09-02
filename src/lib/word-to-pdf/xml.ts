/** DOM helpers that ignore OOXML prefixes and talk in local names. */

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("The Word document XML is damaged.");
  return doc;
}

export function kids(el: Element | null | undefined): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1) out.push(node as Element);
  }
  return out;
}

export function kid(el: Element | null | undefined, name: string): Element | undefined {
  return kids(el).find((child) => child.localName === name);
}

export function descendants(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS("*", name));
}

export function attr(el: Element | null | undefined, name: string): string | undefined {
  if (!el) return undefined;
  const direct = el.getAttribute(name);
  if (direct != null) return direct;
  for (const item of Array.from(el.attributes)) {
    if (item.localName === name) return item.value;
  }
  return undefined;
}

export function val(el: Element | null | undefined): string | undefined {
  return attr(el, "val");
}

export function numAttr(el: Element | null | undefined, name: string): number | undefined {
  const raw = attr(el, name);
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function numVal(el: Element | null | undefined): number | undefined {
  const raw = val(el);
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const TWIP_PER_PT = 20;
export const EMU_PER_PT = 12700;

export function twip(value: number | undefined, fallback = 0): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value / TWIP_PER_PT;
}

export function emu(value: number | undefined, fallback = 0): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value / EMU_PER_PT;
}

export function halfPt(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value / 2;
}
