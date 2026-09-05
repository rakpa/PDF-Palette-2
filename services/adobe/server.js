const express = require("express");

const ADOBE_BASE = "https://pdf-services.adobe.io";
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_TYPE = "application/msword";

function strip(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function credentials() {
  const id = strip(process.env.PDF_SERVICES_CLIENT_ID);
  const secret = strip(process.env.PDF_SERVICES_CLIENT_SECRET);
  if (id && secret && !id.startsWith("{")) {
    return { clientId: id, clientSecret: secret };
  }
  for (const raw of [
    process.env.PDF_SERVICES_CREDENTIALS_JSON,
    process.env.PDF_SERVICES_CLIENT_ID,
    process.env.PDF_SERVICES_CREDENTIALS,
  ]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const clientId = strip(parsed.client_credentials?.client_id ?? parsed.client_id);
      const clientSecret = strip(parsed.client_credentials?.client_secret ?? parsed.client_secret);
      if (clientId && clientSecret) return { clientId, clientSecret };
    } catch {
      // keep looking
    }
  }
  return null;
}

let cachedToken = null;

async function accessToken() {
  const creds = credentials();
  if (!creds) {
    const error = new Error(
      "Adobe PDF Services is not configured. Set PDF_SERVICES_CLIENT_ID and PDF_SERVICES_CLIENT_SECRET in Vercel project settings."
    );
    error.statusCode = 503;
    throw error;
  }
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return { creds, token: cachedToken.accessToken };
  }
  const res = await fetch(`${ADOBE_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  if (!res.ok) {
    cachedToken = null;
    const error = new Error(
      res.status === 401 || res.status === 403
        ? "Adobe PDF Services rejected the API credentials."
        : `Adobe authentication failed (HTTP ${res.status})`
    );
    error.statusCode = res.status === 401 || res.status === 403 ? 503 : 502;
    throw error;
  }
  const body = await res.json();
  if (!body.access_token) {
    const error = new Error("Adobe PDF Services returned no access token.");
    error.statusCode = 502;
    throw error;
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };
  return { creds, token: body.access_token };
}

async function createAsset(mediaType) {
  const { creds, token } = await accessToken();
  const res = await fetch(`${ADOBE_BASE}/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-API-Key": creds.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mediaType }),
  });
  if (!res.ok) {
    const error = new Error(`Adobe asset create failed (HTTP ${res.status})`);
    error.statusCode = 502;
    throw error;
  }
  const body = await res.json();
  if (!body.assetID || !body.uploadUri) {
    const error = new Error("Adobe PDF Services did not return an upload URL.");
    error.statusCode = 502;
    throw error;
  }
  return { assetID: body.assetID, uploadUri: body.uploadUri, mediaType };
}

function pickDownloadUri(body) {
  const asset = body.asset || {};
  const resource = body.resource || {};
  return (
    asset.downloadUri ||
    asset.dowloadUri ||
    resource.downloadUri ||
    body.downloadUri ||
    body.dowloadUri
  );
}

async function runJob(assetID, operation) {
  const { creds, token } = await accessToken();
  const payload = { assetID };
  if (operation === "exportpdf") payload.targetFormat = "docx";
  const started = await fetch(`${ADOBE_BASE}/operation/${operation}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-API-Key": creds.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (started.status !== 201 && started.status !== 202) {
    const error = new Error(`Adobe conversion job failed (HTTP ${started.status})`);
    error.statusCode = 502;
    throw error;
  }
  const location = started.headers.get("location") || started.headers.get("Location");
  if (!location) {
    const error = new Error("Adobe PDF Services did not return a job status URL.");
    error.statusCode = 502;
    throw error;
  }
  const statusUrl = location.startsWith("http") ? location : new URL(location, ADOBE_BASE).href;
  const deadline = Date.now() + 5 * 60 * 1000;
  let delay = 1000;
  while (Date.now() < deadline) {
    const polled = await fetch(statusUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-API-Key": creds.clientId,
      },
    });
    if (!polled.ok) {
      const error = new Error(`Adobe job poll failed (HTTP ${polled.status})`);
      error.statusCode = 502;
      throw error;
    }
    const body = await polled.json();
    const status = String(body.status || "").toLowerCase();
    if (status === "done" || status === "completed" || status === "success") {
      const downloadUri = pickDownloadUri(body);
      if (!downloadUri) {
        const error = new Error("Adobe finished the job but returned no download URL.");
        error.statusCode = 502;
        throw error;
      }
      return { downloadUri };
    }
    if (status === "failed" || status === "error") {
      const error = new Error(body.error?.message || "Adobe PDF Services could not convert this file.");
      error.statusCode = 422;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  const error = new Error("Adobe PDF Services took too long to convert this file.");
  error.statusCode = 504;
  throw error;
}

function routePath(url) {
  const path = (url || "/").split("?")[0];
  return (
    path
      .replace(/^\/api\/adobe/, "")
      .replace(/^\/_\/adobe/, "")
      .replace(/^\/_\/word-to-pdf/, "") || "/"
  );
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    const path = routePath(req.url);

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      res.end();
      return;
    }

    if (method === "GET" && (path === "/" || path === "/health")) {
      const adobe = Boolean(credentials());
      send(res, adobe ? 200 : 503, {
        status: adobe ? "ok" : "degraded",
        checks: { adobe },
        engine: adobe ? "adobe-pdf-services" : "unconfigured",
        conversions: adobe ? ["word-to-pdf", "pdf-to-word"] : [],
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (method === "POST" && path === "/v1/pdf-to-word/asset") {
      send(res, 200, await createAsset(PDF_TYPE));
      return;
    }

    if (method === "POST" && path === "/v1/word-to-pdf/asset") {
      const body = await readJson(req);
      const filename = typeof body.filename === "string" ? body.filename : "document.docx";
      const mediaType = /\.doc$/i.test(filename) && !/\.docx$/i.test(filename) ? DOC_TYPE : DOCX_TYPE;
      send(res, 200, await createAsset(mediaType));
      return;
    }

    if (method === "POST" && path === "/v1/pdf-to-word/jobs") {
      const body = await readJson(req);
      const assetID = typeof body.assetID === "string" ? body.assetID.trim() : "";
      const filename = typeof body.filename === "string" ? body.filename : "document.pdf";
      if (!assetID) {
        send(res, 400, { error: "assetID is required." });
        return;
      }
      const result = await runJob(assetID, "exportpdf");
      const base = filename.replace(/\.pdf$/i, "") || "document";
      send(res, 200, {
        downloadUri: result.downloadUri,
        filename: `${base}.docx`,
        contentType: DOCX_TYPE,
      });
      return;
    }

    if (method === "POST" && path === "/v1/word-to-pdf/jobs") {
      const body = await readJson(req);
      const assetID = typeof body.assetID === "string" ? body.assetID.trim() : "";
      const filename = typeof body.filename === "string" ? body.filename : "document.docx";
      if (!assetID) {
        send(res, 400, { error: "assetID is required." });
        return;
      }
      const result = await runJob(assetID, "createpdf");
      const base = filename.replace(/\.docx?$/i, "") || "document";
      send(res, 200, {
        downloadUri: result.downloadUri,
        filename: `${base}.pdf`,
        contentType: PDF_TYPE,
      });
      return;
    }

    send(res, 404, { error: "Not found", path });
  } catch (error) {
    send(res, error.statusCode || 500, {
      error: error.message || "Conversion service failed",
    });
  }
}

const app = express();
app.use((req, res) => {
  handler(req, res).catch((error) => {
    if (!res.headersSent) {
      send(res, 500, { error: error.message || "Conversion service failed" });
    }
  });
});

module.exports = app;

if (require.main === module) {
  app.listen(Number(process.env.PORT) || 3002);
}
