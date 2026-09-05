// Adobe PDF Services REST client, shared by the /api/adobe/* functions.
//
// Flow (https://developer.adobe.com/document-services/docs/apis/):
//   POST /token                     -> access_token
//   POST /assets {mediaType}        -> {assetID, uploadUri}   (browser PUTs the file)
//   POST /operation/exportpdf       -> 201 + Location header
//   GET  <Location>                 -> {status: in progress|done|failed, asset:{downloadUri}}
//
// The poll is deliberately NOT looped here: a serverless function that waits for
// Adobe blows through the platform's execution limit and the caller sees a 500.
// The browser drives the poll one short request at a time instead.

export const ADOBE_BASE = "https://pdf-services.adobe.io";
export const PDF_TYPE = "application/pdf";
export const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC_TYPE = "application/msword";

export class AdobeError extends Error {
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

/**
 * Accepts either the two plain variables or the contents of
 * pdfservices-api-credentials.json pasted into a single variable.
 */
export function credentials() {
  const id = strip(
    process.env.PDF_SERVICES_CLIENT_ID || process.env.ADOBE_CLIENT_ID
  );
  const secret = strip(
    process.env.PDF_SERVICES_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET
  );
  if (id && secret && !id.startsWith("{")) return { clientId: id, clientSecret: secret };

  for (const raw of [
    process.env.PDF_SERVICES_CREDENTIALS_JSON,
    process.env.PDF_SERVICES_CREDENTIALS,
    process.env.PDF_SERVICES_CLIENT_ID,
  ]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const clientId = strip(parsed.client_credentials?.client_id ?? parsed.client_id);
      const clientSecret = strip(
        parsed.client_credentials?.client_secret ?? parsed.client_secret
      );
      if (clientId && clientSecret) return { clientId, clientSecret };
    } catch {
      // not JSON — keep looking
    }
  }
  return null;
}

let cachedToken = null;

export async function accessToken() {
  const creds = credentials();
  if (!creds) {
    throw new AdobeError(
      "Adobe PDF Services is not configured. Set PDF_SERVICES_CLIENT_ID and PDF_SERVICES_CLIENT_SECRET on the deployment.",
      503
    );
  }
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 120_000) {
    return { creds, token: cachedToken.accessToken };
  }
  cachedToken = null;

  const res = await fetch(`${ADOBE_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const detail = body.error_description || body.error || body.message;
    throw new AdobeError(
      res.status === 401 || res.status === 403
        ? `Adobe rejected the API credentials${detail ? `: ${detail}` : "."}`
        : `Adobe authentication failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      res.status === 401 || res.status === 403 ? 503 : 502
    );
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };
  return { creds, token: body.access_token };
}

async function adobeMessage(res) {
  const text = await res.text().catch(() => "");
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error?.message || parsed.error_description || "";
  } catch {
    return text.slice(0, 200);
  }
}

export async function createAsset(mediaType) {
  const { creds, token } = await accessToken();
  const res = await fetch(`${ADOBE_BASE}/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": creds.clientId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ mediaType }),
  });
  if (!res.ok) {
    const detail = await adobeMessage(res);
    throw new AdobeError(
      `Adobe would not accept the upload (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      res.status === 401 || res.status === 403 ? 503 : 502,
      res.headers.get("x-request-id")
    );
  }
  const body = await res.json();
  if (!body.assetID || !body.uploadUri) {
    throw new AdobeError("Adobe PDF Services did not return an upload URL.", 502);
  }
  return { assetID: body.assetID, uploadUri: body.uploadUri, mediaType };
}

/** Starts the job and returns the status URL Adobe hands back in `location`. */
export async function startJob(operation, payload) {
  const { creds, token } = await accessToken();
  const res = await fetch(`${ADOBE_BASE}/operation/${operation}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": creds.clientId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status !== 201 && res.status !== 202) {
    const detail = await adobeMessage(res);
    throw new AdobeError(
      `Adobe could not start the conversion (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403
        ? 422
        : 502,
      res.headers.get("x-request-id")
    );
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new AdobeError("Adobe PDF Services did not return a job status URL.", 502);
  }
  return location.startsWith("http") ? location : new URL(location, ADOBE_BASE).href;
}

/** Guards the client-supplied status URL: Adobe's own hosts only. */
export function assertAdobeStatusUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new AdobeError("Invalid job status URL.", 400);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "adobe.io" && !host.endsWith(".adobe.io"))) {
    throw new AdobeError("Invalid job status URL.", 400);
  }
  return url.href;
}

/** One poll. Returns {state: "running"} or {state: "done", downloadUri}. */
export async function pollJob(statusUrl) {
  const { creds, token } = await accessToken();
  const res = await fetch(statusUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": creds.clientId,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const detail = await adobeMessage(res);
    throw new AdobeError(
      `Adobe job status check failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      502,
      res.headers.get("x-request-id")
    );
  }
  const body = await res.json();
  const status = String(body.status || "").toLowerCase();

  if (status === "done" || status === "completed" || status === "success") {
    const asset = body.asset || body.resource || {};
    // Adobe's own docs and responses have shipped both spellings.
    const downloadUri =
      asset.downloadUri || asset.dowloadUri || body.downloadUri || body.dowloadUri;
    if (!downloadUri) {
      throw new AdobeError("Adobe finished the job but returned no download URL.", 502);
    }
    return { state: "done", downloadUri };
  }
  if (status === "failed" || status === "error") {
    throw new AdobeError(
      body.error?.message ||
        body.message ||
        "Adobe PDF Services could not convert this file.",
      422
    );
  }
  return { state: "running" };
}

export function mediaTypeForWord(filename) {
  return /\.doc$/i.test(filename || "") && !/\.docx$/i.test(filename || "")
    ? DOC_TYPE
    : DOCX_TYPE;
}
