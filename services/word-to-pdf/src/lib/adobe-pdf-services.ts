import fs from "node:fs/promises";

const ADOBE_BASE = "https://pdf-services.adobe.io";

export const ADOBE_MEDIA = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
} as const;

export class AdobeConversionError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500
  ) {
    super(message);
    this.name = "AdobeConversionError";
  }
}

export type AdobeCredentials = {
  clientId: string;
  clientSecret: string;
};

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

function authHeaders(credentials: AdobeCredentials, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-API-Key": credentials.clientId,
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "");
  if (!text) return `${fallback} (HTTP ${res.status})`;
  try {
    const body = JSON.parse(text) as {
      error?: { message?: string; code?: string } | string;
      message?: string;
      error_description?: string;
    };
    if (typeof body.error === "object" && body.error?.message) return body.error.message;
    if (typeof body.error === "string" && body.error) return body.error;
    if (body.message) return body.message;
    if (body.error_description) return body.error_description;
  } catch {
    // Keep a short snippet of the raw body rather than dumping HTML.
  }
  const snippet = text.replace(/\s+/g, " ").slice(0, 180);
  return snippet ? `${fallback}: ${snippet}` : `${fallback} (HTTP ${res.status})`;
}

async function fetchAdobe(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AdobeConversionError("Adobe PDF Services timed out.", 504);
    }
    throw new AdobeConversionError(
      error instanceof Error ? error.message : "Adobe PDF Services request failed.",
      502
    );
  }
}

export async function getAdobeAccessToken(
  credentials: AdobeCredentials,
  timeoutMs = 20_000
): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) {
    return cachedToken.accessToken;
  }

  const res = await fetchAdobe(
    `${ADOBE_BASE}/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    },
    timeoutMs
  );

  if (!res.ok) {
    cachedToken = null;
    const message = await readErrorMessage(res, "Adobe authentication failed");
    throw new AdobeConversionError(
      res.status === 401 || res.status === 403
        ? "Adobe PDF Services rejected the API credentials."
        : message,
      res.status === 401 || res.status === 403 ? 503 : 502
    );
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new AdobeConversionError("Adobe PDF Services returned no access token.", 502);
  }

  const expiresInSec = typeof body.expires_in === "number" ? body.expires_in : 3600;
  cachedToken = {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  };
  return body.access_token;
}

async function createAsset(
  credentials: AdobeCredentials,
  token: string,
  mediaType: string,
  timeoutMs: number
): Promise<{ assetID: string; uploadUri: string }> {
  const res = await fetchAdobe(
    `${ADOBE_BASE}/assets`,
    {
      method: "POST",
      headers: {
        ...authHeaders(credentials, token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mediaType }),
    },
    timeoutMs
  );

  if (!res.ok) {
    throw new AdobeConversionError(await readErrorMessage(res, "Adobe asset create failed"), 502);
  }

  const body = (await res.json()) as { assetID?: string; uploadUri?: string };
  if (!body.assetID || !body.uploadUri) {
    throw new AdobeConversionError("Adobe PDF Services did not return an upload URL.", 502);
  }
  return { assetID: body.assetID, uploadUri: body.uploadUri };
}

async function uploadAssetBytes(
  uploadUri: string,
  bytes: Buffer,
  mediaType: string,
  timeoutMs: number
): Promise<void> {
  const res = await fetchAdobe(
    uploadUri,
    {
      method: "PUT",
      headers: {
        "Content-Type": mediaType,
        "Content-Length": String(bytes.byteLength),
      },
      body: new Uint8Array(bytes),
    },
    timeoutMs
  );

  if (!res.ok) {
    throw new AdobeConversionError(await readErrorMessage(res, "Adobe asset upload failed"), 502);
  }
}

async function deleteAsset(
  credentials: AdobeCredentials,
  token: string,
  assetID: string
): Promise<void> {
  try {
    await fetchAdobe(
      `${ADOBE_BASE}/assets/${encodeURIComponent(assetID)}`,
      { method: "DELETE", headers: authHeaders(credentials, token) },
      15_000
    );
  } catch {
    // Best-effort cleanup — Adobe expires assets on its own.
  }
}

async function submitJob(
  credentials: AdobeCredentials,
  token: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<string> {
  const res = await fetchAdobe(
    `${ADOBE_BASE}${path}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(credentials, token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (res.status !== 201 && res.status !== 202) {
    throw new AdobeConversionError(await readErrorMessage(res, "Adobe conversion job failed"), 502);
  }

  const location = res.headers.get("location") || res.headers.get("Location");
  if (!location) {
    throw new AdobeConversionError("Adobe PDF Services did not return a job status URL.", 502);
  }
  return location.startsWith("http") ? location : new URL(location, ADOBE_BASE).href;
}

type JobStatus = {
  status: string;
  downloadUri?: string;
  assetID?: string;
  errorMessage?: string;
};

function pickDownloadUri(body: Record<string, unknown>): string | undefined {
  const asset = body.asset as Record<string, unknown> | undefined;
  const resource = body.resource as Record<string, unknown> | undefined;
  const candidates = [
    asset?.downloadUri,
    asset?.dowloadUri,
    resource?.downloadUri,
    body.downloadUri,
    body.dowloadUri,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function parseJobStatus(body: Record<string, unknown>): JobStatus {
  const status = typeof body.status === "string" ? body.status : "";
  const error =
    body.error && typeof body.error === "object"
      ? (body.error as { message?: string }).message
      : typeof body.error === "string"
        ? body.error
        : undefined;
  const asset = body.asset as { assetID?: string } | undefined;
  return {
    status: status.toLowerCase(),
    downloadUri: pickDownloadUri(body),
    assetID: asset?.assetID,
    errorMessage: error,
  };
}

async function pollJob(
  credentials: AdobeCredentials,
  token: string,
  location: string,
  timeoutMs: number
): Promise<JobStatus> {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 1000;

  while (Date.now() < deadline) {
    const remaining = Math.max(1000, deadline - Date.now());
    const res = await fetchAdobe(
      location,
      { method: "GET", headers: authHeaders(credentials, token) },
      Math.min(remaining, 30_000)
    );

    if (!res.ok) {
      throw new AdobeConversionError(await readErrorMessage(res, "Adobe job poll failed"), 502);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const job = parseJobStatus(body);

    if (job.status === "done" || job.status === "completed" || job.status === "success") {
      if (!job.downloadUri) {
        throw new AdobeConversionError("Adobe finished the job but returned no download URL.", 502);
      }
      return job;
    }

    if (job.status === "failed" || job.status === "error") {
      throw new AdobeConversionError(
        job.errorMessage || "Adobe PDF Services could not convert this file.",
        422
      );
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 1.5, 5000);
  }

  throw new AdobeConversionError("Adobe PDF Services took too long to convert this file.", 504);
}

async function downloadAsset(downloadUri: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetchAdobe(downloadUri, { method: "GET" }, timeoutMs);
  if (!res.ok) {
    throw new AdobeConversionError(await readErrorMessage(res, "Adobe download failed"), 502);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function convertAssetWithAdobe(options: {
  credentials: AdobeCredentials;
  inputPath: string;
  outputPath: string;
  mediaType: string;
  operation: "exportpdf" | "createpdf";
  targetFormat?: "docx";
  timeoutMs: number;
}): Promise<void> {
  const token = await getAdobeAccessToken(options.credentials);
  const bytes = await fs.readFile(options.inputPath);
  const created = await createAsset(
    options.credentials,
    token,
    options.mediaType,
    Math.min(options.timeoutMs, 30_000)
  );

  let resultAssetID: string | undefined;
  try {
    await uploadAssetBytes(
      created.uploadUri,
      bytes,
      options.mediaType,
      Math.min(options.timeoutMs, 120_000)
    );

    const jobBody: Record<string, unknown> = { assetID: created.assetID };
    if (options.operation === "exportpdf") {
      jobBody.targetFormat = options.targetFormat ?? "docx";
    }

    const location = await submitJob(
      options.credentials,
      token,
      `/operation/${options.operation}`,
      jobBody,
      Math.min(options.timeoutMs, 30_000)
    );

    const result = await pollJob(options.credentials, token, location, options.timeoutMs);
    resultAssetID = result.assetID;
    const output = await downloadAsset(result.downloadUri!, Math.min(options.timeoutMs, 120_000));
    await fs.writeFile(options.outputPath, output);
  } finally {
    await deleteAsset(options.credentials, token, created.assetID);
    if (resultAssetID) {
      await deleteAsset(options.credentials, token, resultAssetID);
    }
  }
}
