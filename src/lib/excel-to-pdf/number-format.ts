/**
 * Excel number formats.
 *
 * A spreadsheet cell stores a bare number; what the reader sees is that number
 * put through a format code. Converting the value without the code turns
 * "£1,234.50" into "1234.5" and a date into "45219", so the format has to come
 * across too. This covers the codes real spreadsheets use — the built-ins, and
 * the custom ones built from the same tokens.
 */

/** The built-in formats, which files reference by id and never spell out. */
const BUILTIN: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "mm-dd-yy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

export function builtinFormat(id: number): string | undefined {
  return BUILTIN[id];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Split on section separators, ignoring semicolons inside quotes or brackets. */
function sections(code: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "[") bracket = true;
    else if (!quoted && ch === "]") bracket = false;
    else if (ch === ";" && !quoted && !bracket) {
      out.push(current);
      current = "";
      continue;
    }
    if (ch === "\\" && i + 1 < code.length) {
      current += ch + code[++i];
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** Strip the parts of a code that colour or condition it rather than shape it. */
function stripDecorations(code: string): string {
  return code.replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, "");
}

function looksLikeDate(code: string): boolean {
  const bare = stripDecorations(code).replace(/"[^"]*"/g, "");
  return /(^|[^\\])[ymdhs]/i.test(bare) && !/e\+/i.test(bare);
}

/**
 * Excel counts days from 1899-12-31, and believes 1900 had a 29th of February.
 * Serial 60 is that day; everything after it is one day ahead of reality, so
 * the epoch is shifted to compensate and 60 is reported as the phantom date.
 */
export function serialToDate(serial: number): Date {
  const whole = Math.floor(serial);
  const fraction = serial - whole;
  const days = whole > 59 ? whole - 1 : whole;
  const ms = Date.UTC(1899, 11, 31) + days * 86400000 + Math.round(fraction * 86400000);
  return new Date(ms);
}

function pad(value: number, width: number): string {
  return String(Math.floor(value)).padStart(width, "0");
}

function formatDate(value: number, code: string): string {
  const date = serialToDate(value);
  const clean = stripDecorations(code);
  const twelveHour = /am\/pm|a\/p/i.test(clean);
  let hours = date.getUTCHours();
  const pm = hours >= 12;
  if (twelveHour) hours = hours % 12 || 12;

  let out = "";
  let i = 0;
  while (i < clean.length) {
    const rest = clean.slice(i);

    if (clean[i] === '"') {
      const end = clean.indexOf('"', i + 1);
      out += clean.slice(i + 1, end < 0 ? clean.length : end);
      i = end < 0 ? clean.length : end + 1;
      continue;
    }
    if (clean[i] === "\\") {
      out += clean[i + 1] ?? "";
      i += 2;
      continue;
    }

    const ampm = /^(AM\/PM|A\/P)/i.exec(rest);
    if (ampm) {
      out += ampm[0].length > 3 ? (pm ? "PM" : "AM") : pm ? "P" : "A";
      i += ampm[0].length;
      continue;
    }

    // Elapsed-time codes in brackets are not clock fields.
    const elapsed = /^\[(h+|m+|s+)\]/i.exec(rest);
    if (elapsed) {
      const unit = elapsed[1][0].toLowerCase();
      const total = value * 24;
      const amount = unit === "h" ? total : unit === "m" ? total * 60 : total * 3600;
      out += pad(amount, elapsed[1].length);
      i += elapsed[0].length;
      continue;
    }

    const run = /^(y+|m+|d+|h+|s+)/i.exec(rest);
    if (run) {
      const token = run[0].toLowerCase();
      const width = token.length;
      switch (token[0]) {
        case "y":
          out += width <= 2 ? pad(date.getUTCFullYear() % 100, 2) : String(date.getUTCFullYear());
          break;
        case "d":
          out += width === 1 ? String(date.getUTCDate())
            : width === 2 ? pad(date.getUTCDate(), 2)
            : width === 3 ? DAYS[date.getUTCDay()].slice(0, 3)
            : DAYS[date.getUTCDay()];
          break;
        case "h":
          out += width === 1 ? String(hours) : pad(hours, 2);
          break;
        case "s":
          out += width === 1 ? String(date.getUTCSeconds()) : pad(date.getUTCSeconds(), 2);
          break;
        case "m": {
          // "m" is minutes next to an hour or a second, and months otherwise.
          const before = clean.slice(0, i).replace(/["\\][^"]*/g, "");
          const after = clean.slice(i + width);
          const minutes = /[hH]\W*$/.test(before) || /^\W*[sS]/.test(after);
          if (minutes) out += width === 1 ? String(date.getUTCMinutes()) : pad(date.getUTCMinutes(), 2);
          else if (width === 1) out += String(date.getUTCMonth() + 1);
          else if (width === 2) out += pad(date.getUTCMonth() + 1, 2);
          else if (width === 3) out += MONTHS[date.getUTCMonth()].slice(0, 3);
          else if (width === 4) out += MONTHS[date.getUTCMonth()];
          else out += MONTHS[date.getUTCMonth()][0];
          break;
        }
      }
      i += width;
      continue;
    }

    out += clean[i];
    i++;
  }
  return out;
}

/** Round half away from zero, the way a spreadsheet displays it. */
function fixed(value: number, places: number): string {
  const factor = 10 ** places;
  const rounded = Math.round(Math.abs(value) * factor + Number.EPSILON) / factor;
  return rounded.toFixed(places);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatNumber(value: number, code: string): string {
  const clean = stripDecorations(code);

  // A percent sign in the code scales the value, as does each trailing comma.
  const percents = (clean.match(/%/g) || []).length;
  let scaled = value * 100 ** percents;

  const numericPart = /[#0?]+(?:[.,][#0?]+)*/.exec(clean.replace(/"[^"]*"/g, ""));
  const pattern = numericPart?.[0] ?? "";
  const trailingCommas = /[#0?](,+)\s*$/.exec(clean.replace(/"[^"]*"/g, ""))?.[1]?.length ?? 0;
  if (trailingCommas) scaled /= 1000 ** trailingCommas;

  // A section with no digit placeholders at all is pure literal text — the
  // "-" that a format like `#,##0;(#,##0);-` shows for zero.
  if (!pattern) {
    return clean.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/[*_]./g, "");
  }

  const [intPattern = "", decPattern = ""] = pattern.split(".");
  const places = (decPattern.match(/[0#?]/g) || []).length;
  const grouped = intPattern.includes(",");
  const minIntDigits = (intPattern.match(/0/g) || []).length;

  const text = fixed(scaled, places);
  let [whole, decimals = ""] = text.split(".");
  if (whole.length < minIntDigits) whole = whole.padStart(minIntDigits, "0");
  if (minIntDigits === 0 && whole === "0" && places > 0) whole = "";
  if (grouped) whole = groupThousands(whole);

  // Optional decimal places (#) drop when they are zero; required ones (0) stay.
  if (decimals) {
    const required = (decPattern.match(/0/g) || []).length;
    while (decimals.length > required && decimals.endsWith("0")) decimals = decimals.slice(0, -1);
  }
  const body = decimals ? `${whole}.${decimals}` : whole;

  // Everything that is not a number token is literal text around it.
  let out = "";
  let placed = false;
  let i = 0;
  while (i < clean.length) {
    const ch = clean[i];
    if (ch === '"') {
      const end = clean.indexOf('"', i + 1);
      out += clean.slice(i + 1, end < 0 ? clean.length : end);
      i = end < 0 ? clean.length : end + 1;
      continue;
    }
    if (ch === "\\") {
      out += clean[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (ch === "*" || ch === "_") {
      // Fill and skip-width markers consume their argument and print nothing.
      i += 2;
      continue;
    }
    if (/[#0?.,]/.test(ch)) {
      if (!placed) {
        out += body;
        placed = true;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return placed ? out : out + body;
}

function general(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e11) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-10)) return value.toExponential(5).replace("e", "E");
  // Spreadsheets show about eleven significant digits in a default column.
  return String(Number(value.toPrecision(11)));
}

/**
 * Render a cell value the way the spreadsheet shows it.
 *
 * Codes carry up to four sections — positive, negative, zero, then text — and
 * the sign decides which one applies.
 */
export function formatCellValue(value: number | string, code: string | undefined): string {
  if (typeof value === "string") {
    const parts = code ? sections(code) : [];
    const textSection = parts.length >= 4 ? parts[3] : undefined;
    if (textSection && textSection.includes("@")) {
      return textSection.replace(/@/g, value).replace(/"/g, "");
    }
    return value;
  }

  if (!code || code === "General" || code.trim() === "") return general(value);

  const parts = sections(code);
  let chosen = parts[0];
  if (value < 0 && parts.length > 1) chosen = parts[1];
  else if (value === 0 && parts.length > 2) chosen = parts[2];

  if (!chosen || !chosen.trim()) return "";
  if (chosen === "General") return general(value);
  if (chosen === "@") return general(value);

  // A negative shown by its own section has already had its sign spoken for.
  const magnitude = value < 0 && parts.length > 1 ? Math.abs(value) : value;

  if (looksLikeDate(chosen)) {
    if (magnitude < 0) return general(value);
    return formatDate(magnitude, chosen);
  }
  const body = formatNumber(magnitude, chosen);
  return value < 0 && parts.length === 1 && !body.startsWith("-") ? `-${body}` : body;
}
