// iLovePDF REST client for /api/ilove/*.
//
// Flow (https://developer.ilovepdf.com/docs/api-reference):
//   local JWT (HS256, jti = public key) or POST /v1/auth { public_key }
//   GET  https://api.ilovepdf.com/v1/start/{tool}  -> { server, task }
//   POST https://{server}/v1/upload                 (browser, multipart)
//   POST https://{server}/v1/process                { task, tool, files }
//   GET  https://{server}/v1/download/{task}
//
// Their public REST catalogue has Office → PDF (`officepdf`) but not
// PDF → Word. startPdfToWord() probes ILOVEPDF_TOOL plus a short list;
// when none exist the card falls back to the in-browser rebuild.

import { createHmac } from "node:crypto";

const API_HOST = "api.ilovepdf.com";
const DEFAULT_TOOLS = ["pdfdocx", "pdfword", "pdftoword", "pdf2word", "pdf_to_word"];

export class ILovePdfError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function strip(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

export function publicKey() {
  return strip(process.env.ILOVEPDF_PUBLIC_KEY);
}

export function secretKey() {
  return strip(process.env.ILOVEPDF_SECRET_KEY);
}

export function configured() {
  return Boolean(publicKey());
}

function b64url(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buf.toString("base64url");
}

/** HS256 JWT matching @ilovepdf/ilovepdf-js-core (jti = public key, iat skew 5s). */
export function makeJwt() {
  const pub = publicKey();
  if (!pub) {
    throw new ILovePdfError(
      "iLovePDF is not configured. Set ILOVEPDF_PUBLIC_KEY on the deployment.",
      503
    );
  }
  const sec = secretKey();
  if (!sec) {
    // Public-only projects exchange the public key for a short-lived token.
    return null;
  }
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "HS256" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      iss: API_HOST,
      iat: now - 5,
      nbf: now - 5,
      exp: now + 2 * 60 * 60,
      jti: pub,
    })
  );
  const sig = createHmac("sha256", sec).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(sig)}`;
}

export async function authToken() {
  const local = makeJwt();
  if (local) return local;
  const res = await fetch(`https://${API_HOST}/v1/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ public_key: publicKey() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new ILovePdfError(
      body.message || "iLovePDF rejected the public key.",
      res.status === 401 || res.status === 403 ? 503 : 502
    );
  }
  return body.token;
}

async function readError(res) {
  const text = await res.text().catch(() => "");
  if (!text) return `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text);
    return (
      parsed.message ||
      parsed.error?.message ||
      (parsed.error && typeof parsed.error === "string" ? parsed.error : "") ||
      text.slice(0, 200)
    );
  } catch {
    return text.slice(0, 200);
  }
}

export async function startTool(tool, token) {
  const name = String(tool || "").trim();
  if (!/^[a-z0-9_]{2,40}$/i.test(name)) {
    throw new ILovePdfError("Invalid iLovePDF tool name.", 400);
  }
  const res = await fetch(`https://${API_HOST}/v1/start/${name}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: body.error?.message || body.message || text.slice(0, 200),
    };
  }
  if (!body.server || !body.task) {
    return { ok: false, status: 502, message: "iLovePDF did not return a worker." };
  }
  return { ok: true, server: body.server, task: body.task, remaining: body.remaining_credits };
}

function toolList() {
  const extra = strip(process.env.ILOVEPDF_TOOL);
  const names = extra ? [extra, ...DEFAULT_TOOLS] : DEFAULT_TOOLS;
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}

let cachedPdfWord = undefined;

export async function startPdfToWord(token) {
  if (cachedPdfWord && cachedPdfWord.ok === false) return cachedPdfWord;
  if (cachedPdfWord && cachedPdfWord.ok && cachedPdfWord.tool) {
    const again = await startTool(cachedPdfWord.tool, token);
    if (again.ok) return { ...again, tool: cachedPdfWord.tool };
    cachedPdfWord = undefined;
  }

  const tried = [];
  for (const tool of toolList()) {
    const result = await startTool(tool, token);
    if (result.ok) {
      cachedPdfWord = { ok: true, tool };
      return { ...result, tool };
    }
    tried.push(`${tool}:${result.status}`);
    // 401/403 on a named tool means it exists but this project cannot use it.
    if (result.status === 401 || result.status === 403) {
      cachedPdfWord = { ok: false, reason: result.message };
      return cachedPdfWord;
    }
  }
  cachedPdfWord = {
    ok: false,
    reason: `iLovePDF has no PDF to Word REST tool (${tried.join(", ")}).`,
  };
  return cachedPdfWord;
}

export function assertWorkerHost(server) {
  const host = String(server || "")
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ilovepdf\.com$/.test(host)) {
    throw new ILovePdfError("Invalid iLovePDF worker host.", 400);
  }
  return host;
}

export function assertTaskId(task) {
  const id = String(task || "").trim();
  if (!/^[A-Za-z0-9]{16,200}$/.test(id)) {
    throw new ILovePdfError("Invalid iLovePDF task id.", 400);
  }
  return id;
}

export function assertServerFilename(name) {
  const value = String(name || "").trim();
  if (!/^[A-Za-z0-9._-]{16,200}$/.test(value)) {
    throw new ILovePdfError("Invalid iLovePDF upload name.", 400);
  }
  return value;
}

export async function processTask({ token, server, task, tool, serverFilename, filename }) {
  const host = assertWorkerHost(server);
  const taskId = assertTaskId(task);
  const uploaded = assertServerFilename(serverFilename);
  const original = String(filename || "document.pdf").slice(0, 200) || "document.pdf";
  const res = await fetch(`https://${host}/v1/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task: taskId,
      tool,
      files: [{ server_filename: uploaded, filename: original }],
    }),
  });
  if (!res.ok) {
    throw new ILovePdfError(
      `iLovePDF could not convert this file: ${await readError(res)}`,
      res.status >= 400 && res.status < 500 ? 422 : 502
    );
  }
  const body = await res.json().catch(() => ({}));
  return {
    downloadUrl: `https://${host}/v1/download/${taskId}`,
    outputExtensions: String(body.output_extensions || ""),
    downloadFilename: body.download_filename || "",
    status: body.status || "",
  };
}

export function looksLikeWord(processResult) {
  const ext = String(processResult.outputExtensions || "").toLowerCase();
  const name = String(processResult.downloadFilename || "").toLowerCase();
  return ext.includes("docx") || ext.includes("doc") || /\.docx?$/.test(name);
}
