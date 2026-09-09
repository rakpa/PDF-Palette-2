import { useEffect } from "react";
import rawToolContent from "./tool-content.json";

export interface ToolFaq {
  q: string;
  a: string;
}

/** Landing-page copy for one tool route. Also consumed by scripts/prerender.mjs. */
export interface ToolContent {
  name: string;
  title: string;
  description: string;
  intro: string;
  steps: string[];
  faqs: ToolFaq[];
}

export const SITE_NAME = "PDF Palette";

export const DEFAULT_TITLE =
  "PDF Palette — 38 Free PDF Tools That Don’t Keep Your Files";

export const DEFAULT_DESCRIPTION =
  "Merge, split, compress, convert, sign, OCR and edit PDFs free. Most tools run in your browser. A few send a file for conversion only — PDF Palette does not store it.";

export const OG_IMAGE_PATH = "/og-image.png";

export const toolContent = rawToolContent as Record<string, ToolContent>;

export const getToolContent = (route: string): ToolContent | undefined =>
  toolContent[route];

type MetaKey = { name: string } | { property: string };

function upsertMeta(key: MetaKey, content: string) {
  const selector =
    "name" in key ? `meta[name="${key.name}"]` : `meta[property="${key.property}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    if ("name" in key) el.setAttribute("name", key.name);
    else el.setAttribute("property", key.property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

export interface SeoOptions {
  title: string;
  description: string;
  /** Absolute path, e.g. "/merge-pdf". Defaults to the current location. */
  path?: string;
  noindex?: boolean;
}

/**
 * Keeps the document head in step with client-side navigation.
 *
 * The static HTML for each route is written at build time by
 * scripts/prerender.mjs; this only has to correct the head once React takes
 * over routing, so the two must agree on how a title is composed.
 */
export function useSeo({ title, description, path, noindex }: SeoOptions) {
  useEffect(() => {
    const url =
      typeof window === "undefined"
        ? ""
        : `${window.location.origin}${path ?? window.location.pathname}`;

    document.title = title;
    upsertMeta({ name: "description" }, description);
    upsertMeta({ property: "og:title" }, title);
    upsertMeta({ property: "og:description" }, description);
    upsertMeta({ property: "og:url" }, url);
    upsertMeta({ name: "twitter:title" }, title);
    upsertMeta({ name: "twitter:description" }, description);
    upsertCanonical(url);

    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (noindex) {
      upsertMeta({ name: "robots" }, "noindex, follow");
    } else if (robots) {
      robots.remove();
    }
  }, [title, description, path, noindex]);
}
