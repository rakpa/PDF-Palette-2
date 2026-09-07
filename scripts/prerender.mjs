/**
 * Post-build SEO pass.
 *
 * The app is a client-rendered SPA, so without this every route would be served
 * the same index.html — one <title> and one description shared by 30 URLs, which
 * is the classic reason a tools site never gets indexed. This writes a real
 * static HTML file per route with its own head (title, description, canonical,
 * Open Graph, JSON-LD), plus sitemap.xml and robots.txt.
 *
 * Vercel serves matching static files before applying the SPA rewrite, so
 * dist/merge-pdf/index.html is what a crawler gets for /merge-pdf; React then
 * hydrates and useSeo keeps the head correct across client-side navigation.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

const toolContent = JSON.parse(
  readFileSync(path.join(root, "src/lib/tool-content.json"), "utf8")
);

const SITE_NAME = "PDF Palette";
const DEFAULT_TITLE = "PDF Palette — 29 Free PDF Tools That Don’t Keep Your Files";
const DEFAULT_DESCRIPTION =
  "Merge, split, compress, convert, sign, OCR and edit PDFs free. Most tools run in your browser. A few send a file for conversion only — PDF Palette does not store it.";

/** Production origin, no trailing slash. Vercel supplies the second form. */
const siteUrl = (
  process.env.SITE_URL ||
  process.env.VITE_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "") ||
  "https://pdf-palette.vercel.app"
).replace(/\/+$/, "");

/** Legal and marketing routes, kept in step with LegalPage's own titles. */
const staticRoutes = {
  "/": {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    priority: "1.0",
    changefreq: "weekly",
  },
  "/about": {
    title: `About Us | ${SITE_NAME}`,
    description:
      "PDF Palette is a set of free PDF tools that run in your browser. Convert, merge, split, compress, OCR, and edit PDFs without creating an account.",
    priority: "0.4",
    changefreq: "yearly",
  },
  "/privacy": {
    title: `Privacy Policy | ${SITE_NAME}`,
    description:
      "How PDF Palette handles your files: almost every tool runs in your browser, there are no accounts, and we do not keep your documents.",
    priority: "0.4",
    changefreq: "yearly",
  },
  "/terms": {
    title: `Terms of Service | ${SITE_NAME}`,
    description: "The terms that apply when you use the free PDF tools on PDF Palette.",
    priority: "0.3",
    changefreq: "yearly",
  },
  "/contact": {
    title: `Contact | ${SITE_NAME}`,
    description:
      "How to reach PDF Palette with bug reports, feature requests and questions about the site.",
    priority: "0.3",
    changefreq: "yearly",
  },
  "/premium": {
    title: `Premium | ${SITE_NAME}`,
    description:
      "PDF Palette Premium — unlimited processing, no ads, stronger OCR, and access to future paid tools. Monthly $4.99 or yearly $29.99.",
    priority: "0.6",
    changefreq: "monthly",
  },
};

const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const jsonLd = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(
    /</g,
    "\\u003c"
  )}</script>`;

const organization = {
  "@type": "Organization",
  "@id": `${siteUrl}/#organization`,
  name: SITE_NAME,
  url: `${siteUrl}/`,
  logo: `${siteUrl}/og-image.png`,
  sameAs: ["https://github.com/rakpa/PDF-Palette-2"],
};

function homeGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: SITE_NAME,
        description: DEFAULT_DESCRIPTION,
        publisher: { "@id": `${siteUrl}/#organization` },
      },
      {
        "@type": "ItemList",
        name: "Free PDF tools",
        itemListElement: Object.entries(toolContent).map(([route, tool], index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: tool.name,
          url: `${siteUrl}${route}`,
        })),
      },
    ],
  };
}

function toolGraph(route, tool) {
  const url = `${siteUrl}${route}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#app`,
        name: `${tool.name} — ${SITE_NAME}`,
        url,
        description: tool.description,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript. Works in any modern browser.",
        isAccessibleForFree: true,
        publisher: { "@id": `${siteUrl}/#organization` },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
          { "@type": "ListItem", position: 2, name: tool.name, item: url },
        ],
      },
      {
        "@type": "HowTo",
        name: `How to ${tool.name.toLowerCase()}`,
        description: tool.intro,
        step: tool.steps.map((text, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          text,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: tool.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      },
    ],
  };
}

function head({ route, title, description, graph, noindex }) {
  const url = `${siteUrl}${route === "/" ? "/" : route}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    noindex ? `<meta name="robots" content="noindex, follow" />` : "",
    `<meta name="author" content="${SITE_NAME}" />`,
    `<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="#0b0f14" media="(prefers-color-scheme: dark)" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${siteUrl}/og-image.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${siteUrl}/og-image.png" />`,
    graph ? jsonLd(graph) : "",
  ]
    .filter(Boolean)
    .join("\n    ");
}

/** Drop the shell's placeholder SEO tags so per-route ones are unambiguous. */
function stripExistingSeo(html) {
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta[^>]*\bname="(description|author|twitter:[^"]*|robots|theme-color)"[^>]*>\s*/gi, "")
    .replace(/<meta[^>]*\bproperty="og:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<link[^>]*rel="canonical"[^>]*>\s*/gi, "");
}

const shell = readFileSync(path.join(dist, "index.html"), "utf8");
const base = stripExistingSeo(shell);

function writePage(route, meta, graph, { noindex = false, file } = {}) {
  const html = base.replace(
    /<\/head>/i,
    `  ${head({ route, ...meta, graph, noindex })}\n  </head>`
  );
  const target = file ?? path.join(dist, route === "/" ? "index.html" : `${route.slice(1)}/index.html`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, html);
}

const urls = [];

for (const [route, meta] of Object.entries(staticRoutes)) {
  writePage(route, meta, route === "/" ? homeGraph() : null);
  urls.push({ route, priority: meta.priority, changefreq: meta.changefreq });
}

for (const [route, tool] of Object.entries(toolContent)) {
  writePage(route, { title: tool.title, description: tool.description }, toolGraph(route, tool));
  urls.push({ route, priority: "0.9", changefreq: "monthly" });
}

writePage(
  "/404",
  {
    title: `Page not found | ${SITE_NAME}`,
    description: "This page does not exist. Browse the free PDF tools on PDF Palette instead.",
  },
  null,
  { noindex: true, file: path.join(dist, "404.html") }
);

const lastmod = new Date().toISOString().slice(0, 10);
writeFileSync(
  path.join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        ({ route, priority, changefreq }) =>
          `  <url>\n` +
          `    <loc>${siteUrl}${route === "/" ? "/" : route}</loc>\n` +
          `    <lastmod>${lastmod}</lastmod>\n` +
          `    <changefreq>${changefreq}</changefreq>\n` +
          `    <priority>${priority}</priority>\n` +
          `  </url>`
      )
      .join("\n") +
    `\n</urlset>\n`
);

const robots = readFileSync(path.join(dist, "robots.txt"), "utf8").replace(
  /\s*Sitemap:.*$/gm,
  ""
);
writeFileSync(path.join(dist, "robots.txt"), `${robots.trimEnd()}\n\nSitemap: ${siteUrl}/sitemap.xml\n`);

console.log(
  `prerender: ${urls.length} routes + 404 · sitemap.xml · robots.txt · origin ${siteUrl}`
);
