// CloudConvert REST client, shared by the /api/convert/* functions.
//
// Flow (https://cloudconvert.com/api/v2):
//   POST /v2/jobs { import/upload + convert + export/url }
//     -> { id, tasks[].result.form }   (browser POSTs the file to form.url)
//   GET  /v2/jobs/{id}
//     -> { status, tasks[].result.files[0].url }
//
// The poll is deliberately NOT looped here: a serverless function that waits
// for CloudConvert blows through the platform's execution limit and the caller
// sees a 500. The browser drives the poll one short request at a time instead.

export const CC_BASE = "https://api.cloudconvert.com/v2";
export const PDF_TYPE = "application/pdf";
export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC_TYPE = "application/msword";

export class CloudConvertError extends Error {
  constructor(message, statusCode, requestId) {
    super(message);
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}

function strip(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

export function apiKey() {
  return strip(process.env.CLOUDCONVERT_API_KEY);
}

function requireKey() {
  const key = apiKey();
  if (!key) {
    throw new CloudConvertError(
      "CloudConvert is not configured. Set CLOUDCONVERT_API_KEY on the deployment.",
      503
    );
  }
  return key;
}

async function ccMessage(res) {
  const text = await res.text().catch(() => "");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return (
      parsed.message ||
      parsed.error ||
      (parsed.errors && JSON.stringify(parsed.errors)) ||
      ""
    );
  } catch {
    return text.slice(0, 200);
  }
}

async function ccFetch(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      Accept: "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await ccMessage(res);
    throw new CloudConvertError(
      res.status === 401 || res.status === 403
        ? `CloudConvert rejected the API key${detail ? `: ${detail}` : "."}`
        : `CloudConvert request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      res.status === 401 || res.status === 403 ? 503 : 502
    );
  }
  const body = await res.json().catch(() => ({}));
  return body.data || body;
}

/** Creates a job and returns the browser-facing upload form. */
export async function createUploadJob(inputFormat, outputFormat) {
  const job = await ccFetch(`${CC_BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    throw new CloudConvertError("CloudConvert did not return an upload URL.", 502);
  }
  return {
    jobId: job.id,
    uploadUrl: form.url,
    formParameters: form.parameters,
  };
}

/** Guards the client-supplied job id: CloudConvert ids are UUID-shaped. */
export function assertJobId(value) {
  const jobId = String(value ?? "").trim();
  if (!/^[A-Za-z0-9-]{8,80}$/.test(jobId)) {
    throw new CloudConvertError("Invalid conversion job id.", 400);
  }
  return jobId;
}

function pickDownload(job) {
  const exportTask = (job.tasks || []).find((task) => task.operation === "export/url");
  return exportTask?.result?.files?.[0]?.url || null;
}

function jobError(job) {
  const failed = (job.tasks || []).find(
    (task) => task.status === "error" || task.status === "failed"
  );
  return failed?.message || job.message || "CloudConvert could not convert this file.";
}

/** One poll. Returns {state: "running"} or {state: "done", downloadUri}. */
export async function pollJob(jobId) {
  const job = await ccFetch(`${CC_BASE}/jobs/${assertJobId(jobId)}`);
  const status = String(job.status || "").toLowerCase();

  if (status === "finished") {
    const downloadUri = pickDownload(job);
    if (!downloadUri) {
      throw new CloudConvertError(
        "CloudConvert finished the job but returned no download URL.",
        502
      );
    }
    return { state: "done", downloadUri };
  }
  if (status === "error" || status === "failed") {
    throw new CloudConvertError(jobError(job), 422);
  }
  return { state: "running" };
}

export function mediaTypeForWord(filename) {
  return /\.doc$/i.test(filename || "") && !/\.docx$/i.test(filename || "")
    ? DOC_TYPE
    : DOCX_TYPE;
}

export function wordInputFormat(filename) {
  return /\.doc$/i.test(filename || "") && !/\.docx$/i.test(filename || "") ? "doc" : "docx";
}
