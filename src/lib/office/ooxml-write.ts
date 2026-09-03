import { createZip, type ZipEntry } from "../zip-write";

/**
 * Writing Office packages.
 *
 * An .xlsx or .pptx is a zip of XML parts plus a content-type manifest and a
 * web of relationship files. This assembles that shape so the emitters can
 * think about documents rather than about packaging.
 */

export const XML_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

export interface Part {
  path: string;
  data: string | Uint8Array;
  /** Required for XML parts; binary parts are covered by a Default entry. */
  contentType?: string;
}

const DEFAULTS: Array<[string, string]> = [
  ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
  ["xml", "application/xml"],
  ["png", "image/png"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
];

/**
 * XML 1.0 cannot carry most control characters at all, so they are dropped.
 * Matching them is the whole point here, hence the rule exemption.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function escapeXml(text: string): string {
  return text
    .replace(CONTROL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
}

export function relationshipsXml(relationships: Relationship[]): string {
  const entries = relationships
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"/>`
    )
    .join("");
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
}

export async function createPackage(parts: Part[]): Promise<Uint8Array> {
  const overrides = parts
    .filter((part) => part.contentType)
    .map((part) => `<Override PartName="/${part.path}" ContentType="${part.contentType}"/>`)
    .join("");

  const defaults = DEFAULTS.map(
    ([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`
  ).join("");

  const contentTypes =
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `${defaults}${overrides}</Types>`;

  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    ...parts.map((part) => ({
      name: part.path,
      data: typeof part.data === "string" ? encoder.encode(part.data) : part.data,
    })),
  ];

  return createZip(entries);
}
