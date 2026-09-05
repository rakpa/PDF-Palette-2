const { createServer } = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const CC_BASE = "https://api.cloudconvert.com/v2";
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_TYPE = "application/msword";

function loadDotEnv() {
  for (const file of [
    path.join(__dirname, ".env"),
    path.join(__dirname, "..", "word-to-pdf", ".env"),
  ]) {
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // optional
    }
  }
}

loadDotEnv();

function strip(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function apiKey() {
  return strip(process.env.CLOUDCONVERT_API_KEY);
}

function authHeaders() {
  const key = apiKey();
  if (!key) {
    const error = new Error(
      "CloudConvert is not configured. Set CLOUDCONVERT_API_KEY in Vercel project settings."
    );
    error.statusCode = 503;
    throw error;
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function ccFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!res.ok) {
    const message =
      body.message ||
      body.error ||
      (body.errors && JSON.stringify(body.errors)) ||
      `CloudConvert request failed (HTTP ${res.status})`;
    const error = new Error(message);
    error.statusCode = res.status === 401 || res.status === 403 ? 503 : 502;
    throw error;
  }
  return body.data || body;
}

async function createUploadJob(inputFormat, outputFormat) {
  const job = await ccFetch(`${CC_BASE}/jobs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      tasks: {
        "import-file": { operation: "import/upload" },
        "convert-file": {
          operation: "convert",
          input: "import-file",
          input_format: inputFormat,
          output_format: outputFormat,
        },
        "export-file": { operation: "export/url", input: "convert-file" },
      },
    }),
  });
  const importTask = (job.tasks || []).find((task) => task.operation === "import/upload");
  const form = importTask?.result?.form;
  if (!job.id || !form?.url || !form.parameters) {
    const error = new Error("CloudConvert did not return an upload URL.");
    error.statusCode = 502;
    throw error;
  }
  return {
    jobId: job.id,
    uploadUrl: form.url,
    formParameters: form.parameters,
  };
}

function pickDownload(job) {
  const exportTask = (job.tasks || []).find((task) => task.operation === "export/url");
  return exportTask?.result?.files?.[0]?.url || null;
}

function jobError(job) {
  const failed = (job.tasks || []).find((task) => task.status === "error" || task.status === "failed");
  return failed?.message || job.message || "CloudConvert could not convert this file.";
}

async function waitForDownload(jobId) {
  const deadline = Date.now() + 5 * 60 * 1000;
  let delay = 1000;
  while (Date.now() < deadline) {
    const job = await ccFetch(`${CC_BASE}/jobs/${jobId}`, { headers: authHeaders() });
    const status = String(job.status || "").toLowerCase();
    if (status === "finished") {
      const downloadUri = pickDownload(job);
      if (!downloadUri) {
        const error = new Error("CloudConvert finished the job but returned no download URL.");
        error.statusCode = 502;
        throw error;
      }
      return { downloadUri };
    }
    if (status === "error" || status === "failed") {
      const error = new Error(jobError(job));
      error.statusCode = 422;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  const error = new Error("CloudConvert took too long to convert this file.");
  error.statusCode = 504;
  throw error;
}

function routePath(url) {
  const pathname = (url || "/").split("?")[0];
  return (
    pathname
      .replace(/^\/api\/convert/, "")
      .replace(/^\/_\/convert/, "") || "/"
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

function wordInputFormat(filename) {
  return /\.doc$/i.test(filename) && !/\.docx$/i.test(filename) ? "doc" : "docx";
}

async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    const pathname = routePath(req.url);

    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      res.end();
      return;
    }

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      const configured = Boolean(apiKey());
      send(res, configured ? 200 : 503, {
        status: configured ? "ok" : "degraded",
        checks: { cloudconvert: configured },
        engine: configured ? "cloudconvert" : "unconfigured",
        conversions: configured ? ["word-to-pdf", "pdf-to-word"] : [],
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (method === "POST" && pathname === "/asset") {
      const body = await readJson(req);
      const kind = body.kind === "word" ? "word" : "pdf";
      const filename = typeof body.filename === "string" ? body.filename : "";
      const created =
        kind === "word"
          ? await createUploadJob(wordInputFormat(filename), "pdf")
          : await createUploadJob("pdf", "docx");
      send(res, 200, {
        ...created,
        mediaType: kind === "word" ? (wordInputFormat(filename) === "doc" ? DOC_TYPE : DOCX_TYPE) : PDF_TYPE,
      });
      return;
    }

    if (method === "POST" && pathname === "/job") {
      const body = await readJson(req);
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      if (!jobId) {
        send(res, 400, { error: "jobId is required." });
        return;
      }
      const toWord = body.kind !== "word-to-pdf";
      const filename = typeof body.filename === "string" ? body.filename : toWord ? "document.pdf" : "document.docx";
      send(res, 200, {
        jobId,
        filename: toWord
          ? `${filename.replace(/\.pdf$/i, "") || "document"}.docx`
          : `${filename.replace(/\.docx?$/i, "") || "document"}.pdf`,
        contentType: toWord ? DOCX_TYPE : PDF_TYPE,
      });
      return;
    }

    if (method === "POST" && pathname === "/status") {
      const body = await readJson(req);
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      if (!jobId) {
        send(res, 400, { error: "jobId is required." });
        return;
      }
      const job = await ccFetch(`${CC_BASE}/jobs/${jobId}`, { headers: authHeaders() });
      const status = String(job.status || "").toLowerCase();
      if (status === "finished") {
        const downloadUri = pickDownload(job);
        if (!downloadUri) {
          send(res, 502, { error: "CloudConvert finished the job but returned no download URL." });
          return;
        }
        send(res, 200, { state: "done", downloadUri });
        return;
      }
      if (status === "error" || status === "failed") {
        send(res, 422, { error: jobError(job) });
        return;
      }
      send(res, 200, { state: "running" });
      return;
    }

    if (method === "POST" && pathname === "/v1/pdf-to-word/asset") {
      const created = await createUploadJob("pdf", "docx");
      send(res, 200, { ...created, mediaType: PDF_TYPE });
      return;
    }

    if (method === "POST" && pathname === "/v1/word-to-pdf/asset") {
      const body = await readJson(req);
      const filename = typeof body.filename === "string" ? body.filename : "document.docx";
      const inputFormat = wordInputFormat(filename);
      const created = await createUploadJob(inputFormat, "pdf");
      send(res, 200, {
        ...created,
        mediaType: inputFormat === "doc" ? DOC_TYPE : DOCX_TYPE,
      });
      return;
    }

    if (method === "POST" && pathname === "/v1/pdf-to-word/jobs") {
      const body = await readJson(req);
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      const filename = typeof body.filename === "string" ? body.filename : "document.pdf";
      if (!jobId) {
        send(res, 400, { error: "jobId is required." });
        return;
      }
      const result = await waitForDownload(jobId);
      const base = filename.replace(/\.pdf$/i, "") || "document";
      send(res, 200, {
        downloadUri: result.downloadUri,
        filename: `${base}.docx`,
        contentType: DOCX_TYPE,
      });
      return;
    }

    if (method === "POST" && pathname === "/v1/word-to-pdf/jobs") {
      const body = await readJson(req);
      const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
      const filename = typeof body.filename === "string" ? body.filename : "document.docx";
      if (!jobId) {
        send(res, 400, { error: "jobId is required." });
        return;
      }
      const result = await waitForDownload(jobId);
      const base = filename.replace(/\.docx?$/i, "") || "document";
      send(res, 200, {
        downloadUri: result.downloadUri,
        filename: `${base}.pdf`,
        contentType: PDF_TYPE,
      });
      return;
    }

    send(res, 404, { error: "Not found", path: pathname });
  } catch (error) {
    send(res, error.statusCode || 500, {
      error: error.message || "Conversion service failed",
    });
  }
}

const server = createServer((req, res) => {
  handler(req, res).catch((error) => {
    if (!res.headersSent) {
      send(res, 500, { error: error.message || "Conversion service failed" });
    }
  });
});

server.listen(Number(process.env.PORT) || 3002);
module.exports = server;
