import {
  serviceErrorFromFetch,
  serviceErrorFromResponse,
} from "./conversion-service-client";
import { convertApiUrl } from "./runtime-config";

type Progress = (progress: number, message?: string) => void;

type AssetResponse = {
  jobId: string;
  uploadUrl: string;
  formParameters: Record<string, string>;
  mediaType: string;
};

type JobResponse = {
  jobId: string;
  filename: string;
  contentType: string;
};

type StatusResponse = {
  state: "running" | "done";
  downloadUri?: string;
};

/** CloudConvert finishes most jobs in seconds; a long book can take a few minutes. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MIN_MS = 1500;
const POLL_MAX_MS = 5000;

async function throwHttpError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) message = data.error;
    else if (res.status === 413) {
      message = "This file is too large to send through the conversion service.";
    } else {
      message = `${fallback} (HTTP ${res.status})`;
    }
  } catch {
    message =
      res.status === 413
        ? "This file is too large to send through the conversion service."
        : `${fallback} (HTTP ${res.status})`;
  }
  throw serviceErrorFromResponse(res.status, message);
}

function bridgeCall(payload: Record<string, unknown>): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = "/convert-bridge.html";
    iframe.style.display = "none";
    const id = `convert-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("CloudConvert transfer timed out."));
    }, 5 * 60 * 1000);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        id?: string;
        ok?: boolean;
        error?: string;
        body?: ArrayBuffer;
      };
      if (data?.type !== "convert-transfer-result" || data.id !== id) return;
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "CloudConvert transfer failed."));
        return;
      }
      resolve(data.body);
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
    };

    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", () => {
      iframe.contentWindow?.postMessage(
        { type: "convert-transfer", id, ...payload },
        window.location.origin
      );
    });
    iframe.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not open the CloudConvert transfer bridge."));
    });
    document.body.appendChild(iframe);
  });
}

async function postFile(
  uploadUrl: string,
  file: File,
  parameters: Record<string, string>
): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(parameters || {})) {
    form.append(key, String(value));
  }
  form.append("file", file);
  try {
    const res = await fetch(uploadUrl, { method: "POST", body: form });
    if (res.ok) return;
    throw new Error(`CloudConvert upload failed (HTTP ${res.status})`);
  } catch {
    await bridgeCall({ action: "post", url: uploadUrl, parameters, body: file });
  }
}

async function getFile(downloadUri: string): Promise<Blob> {
  try {
    const res = await fetch(downloadUri);
    if (res.ok) return await res.blob();
    throw new Error(`CloudConvert download failed (HTTP ${res.status})`);
  } catch {
    const body = await bridgeCall({ action: "get", url: downloadUri });
    if (!body) throw new Error("CloudConvert download returned an empty file.");
    return new Blob([body]);
  }
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw serviceErrorFromFetch(error);
  }
  if (!res.ok) await throwHttpError(res, fallback);
  return (await res.json()) as T;
}

/**
 * Polls from the browser rather than inside the serverless function: a request
 * that waits for CloudConvert outlives the platform's execution limit and comes
 * back as an opaque 500.
 */
async function waitForJob(
  jobId: string,
  onProgress?: Progress,
  message?: string
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let delay = POLL_MIN_MS;
  let progress = 45;

  while (Date.now() < deadline) {
    const status = await postJson<StatusResponse>(
      convertApiUrl("status"),
      { jobId },
      "CloudConvert conversion failed"
    );
    if (status.state === "done" && status.downloadUri) return status.downloadUri;

    progress = Math.min(progress + 4, 82);
    onProgress?.(progress, message);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.3), POLL_MAX_MS);
  }
  throw serviceErrorFromResponse(504, "CloudConvert took too long to convert this file.");
}

export async function convertFileViaCloudConvert(options: {
  file: File;
  mediaType: string;
  kind: "pdf-to-word" | "word-to-pdf";
  onProgress?: Progress;
  uploadingMessage: string;
  convertingMessage: string;
}): Promise<{ blob: Blob; filename: string }> {
  options.onProgress?.(8, options.uploadingMessage);

  const asset = await postJson<AssetResponse>(
    convertApiUrl("asset"),
    {
      filename: options.file.name,
      kind: options.kind === "word-to-pdf" ? "word" : "pdf",
    },
    "Could not start CloudConvert conversion"
  );
  if (!asset.jobId || !asset.uploadUrl) {
    throw new Error("CloudConvert did not return an upload URL.");
  }

  options.onProgress?.(20, options.uploadingMessage);
  await postFile(asset.uploadUrl, options.file, asset.formParameters || {});

  options.onProgress?.(45, options.convertingMessage);
  const job = await postJson<JobResponse>(
    convertApiUrl("job"),
    { jobId: asset.jobId, filename: options.file.name, kind: options.kind },
    "CloudConvert conversion failed"
  );
  if (!job.jobId) {
    throw new Error("CloudConvert did not return a job id.");
  }

  const downloadUri = await waitForJob(
    job.jobId,
    options.onProgress,
    options.convertingMessage
  );

  options.onProgress?.(88, "Preparing download…");
  const blob = await getFile(downloadUri);
  options.onProgress?.(100, "Done");
  return { blob, filename: job.filename };
}
