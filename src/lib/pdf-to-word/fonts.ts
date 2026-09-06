/**
 * PDF font names → font names Word can actually resolve.
 *
 * pdf.js only reports a generic CSS family ("serif"/"sans-serif") on the text
 * content styles, so the real name has to come from the font object on
 * `page.commonObjs`. Those names look like "ABCDEE+Calibri-BoldItalic" or
 * "TimesNewRomanPSMT"; this module turns them into "Calibri" / "Times New
 * Roman" plus bold/italic flags.
 */

const SUBSET_PREFIX = /^[A-Z]{6}\+/;
const STYLE_SUFFIX =
  /[-_,]?(?:regular|book|roman|normal|italic|oblique|bold|semibold|demibold|demi|extrabold|ultrabold|black|heavy|light|extralight|ultralight|thin|medium|condensed|narrow|caption|display|text|subhead)+$/i;
/**
 * Foundry tags that are not part of the name a reader's machine knows. "Pro"
 * and "Std" are deliberately absent: they belong to the family — Minion Pro,
 * Myriad Pro — and trimming them leaves "Minion", which resolves to nothing
 * and makes Word substitute something arbitrary for the whole document.
 */
const TRAILING_TAGS = /(?:MT|PS|PSMT|LT|W\d{2}|SC)$/;

/** Base-14 and other very common PDF faces that have a canonical Word name. */
const FAMILY_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/^(?:helvetica|arial|liberationsans|nimbussans|freesans|arimo)/i, "Arial"],
  [/^(?:times|liberationserif|nimbusroman|freeserif|tinos|thorndale)/i, "Times New Roman"],
  [/^(?:courier(?:new)?|liberationmono|nimbusmono|freemono|cousine)$/i, "Courier New"],
  [/^(?:zapfdingbats|dingbats)/i, "Wingdings"],
  [/^symbol/i, "Symbol"],
  [/^(?:cmr|cmbx|cmti|computermodernroman|nimbusromno9l)/i, "Times New Roman"],
  [/^(?:cmss|computermodernsans)/i, "Arial"],
  [/^(?:cmtt|computermoderntypewriter)/i, "Courier New"],
  [/^(?:carlito)/i, "Calibri"],
  [/^(?:caladea)/i, "Cambria"],
];

/** Word names for families whose PDF spelling drops the spaces. */
const SPACED_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/^timesnewroman/i, "Times New Roman"],
  [/^couriernew/i, "Courier New"],
  [/^courierstd/i, "Courier Std"],
  [/^myriadpro/i, "Myriad Pro"],
  [/^minionpro/i, "Minion Pro"],
  [/^comicsans(?:ms)?/i, "Comic Sans MS"],
  [/^trebuchet(?:ms)?/i, "Trebuchet MS"],
  [/^segoeui/i, "Segoe UI"],
  [/^dejavusansmono/i, "DejaVu Sans Mono"],
  [/^dejavusans/i, "DejaVu Sans"],
  [/^dejavuserif/i, "DejaVu Serif"],
  [/^lucidaconsole/i, "Lucida Console"],
  [/^lucidasans/i, "Lucida Sans"],
  [/^bookantiqua/i, "Book Antiqua"],
  [/^centurygothic/i, "Century Gothic"],
  [/^franklingothic/i, "Franklin Gothic"],
  [/^msgothic/i, "MS Gothic"],
  [/^notosansmono/i, "Noto Sans Mono"],
  [/^notosans/i, "Noto Sans"],
  [/^notoserif/i, "Noto Serif"],
  [/^opensans/i, "Open Sans"],
  [/^ptsans/i, "PT Sans"],
  [/^pfserif/i, "PT Serif"],
  [/^robotomono/i, "Roboto Mono"],
  [/^sourcecodepro/i, "Source Code Pro"],
  [/^sourcesanspro/i, "Source Sans Pro"],
  [/^jetbrainsmono/i, "JetBrains Mono"],
];

const BOLD_RE = /(?:^|[-_,\s])(?:bold|black|heavy|extrabold|ultrabold|semibold|demibold|demi)/i;
const ITALIC_RE = /(?:^|[-_,\s])(?:italic|oblique)/i;
const MONO_RE = /mono|courier|consol|menlo|monaco|typewriter|code|cmtt/i;
const SERIF_RE = /times|serif|roman|georgia|garamond|cambria|palatino|book|minion|charter|utopia|cmr/i;

function splitCamelCase(name: string): string {
  return name.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

/** Turn a raw PDF font name into a Word family plus style flags. */
export function resolveFontName(rawName: string): {
  family: string;
  bold: boolean;
  italic: boolean;
  monospace: boolean;
} {
  const name = (rawName || "").replace(SUBSET_PREFIX, "").trim();
  const bold = BOLD_RE.test(name);
  const italic = ITALIC_RE.test(name);
  const monospace = MONO_RE.test(name);

  // "Calibri-BoldItalic" / "Calibri,Bold" / "Calibri_Bold" → "Calibri"
  let base = name.split(/[-_,]/)[0] || name;
  if (base === name) base = name.replace(STYLE_SUFFIX, "") || name;
  base = base.replace(STYLE_SUFFIX, "") || base;

  for (const [pattern, family] of FAMILY_ALIASES) {
    if (pattern.test(base)) return { family, bold, italic, monospace };
  }
  for (const [pattern, family] of SPACED_NAMES) {
    if (pattern.test(base)) return { family, bold, italic, monospace };
  }

  const cleaned = base.replace(TRAILING_TAGS, "") || base;
  const family = splitCamelCase(cleaned);
  if (!family) {
    return {
      family: monospace ? "Courier New" : "Arial",
      bold,
      italic,
      monospace,
    };
  }
  return { family, bold, italic, monospace };
}

/** Fallback used when only pdf.js' generic CSS family is available. */
export function familyFromGeneric(generic: string | undefined): string {
  const value = (generic ?? "").toLowerCase();
  if (MONO_RE.test(value)) return "Courier New";
  if (SERIF_RE.test(value)) return "Times New Roman";
  return "Arial";
}
