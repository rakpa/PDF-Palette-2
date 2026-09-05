import {
  serviceErrorFromFetch,
  serviceErrorFromResponse,
} from "./conversion-service-client";
import { adobeApiUrl } from "./runtime-config";

type Progress = (progress: number, message?: string) => void;

type AssetResponse = {
  assetID: string;
  uploadUri: string;
  mediaType: string;
};

type JobResponse = {
  statusUrl: string;
  filename: string;
  contentType: string;
};

type StatusResponse = {
  state: "running" | "done";
  downloadUri?: string;
};

/** Adobe finishes most jobs in seconds; a long book can take a few minutes. */
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
    iframe.src = "/adobe-bridge.html";
    iframe.style.display = "none";
    const id = `adobe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Adobe transfer timed out."));
    }, 5 * 60 * 1000);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; id?: string; ok?: boolean; error?: string; body?: ArrayBuffer };
      if (data?.type !== "adobe-transfer-result" || data.id !== id) return;
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "Adobe transfer failed."));
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
      iframe.contentWindow?.postMessage({ type: "adobe-transfer", id, ...payload }, window.location.origin);
    });
    iframe.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not open the Adobe transfer bridge."));
    });
    document.body.appendChild(iframe);
  });
}

async function putFile(uploadUri: string, file: File, mediaType: string): Promise<void> {
  try {
    const res = await fetch(uploadUri, {
      method: "PUT",
      headers: { "Content-Type": mediaType },
      body: file,
    });
    if (res.ok) return;
    throw new Error(`Adobe upload failed (HTTP ${res.status})`);
  } catch {
    await bridgeCall({ action: "put", url: uploadUri, mediaType, body: file });
  }
}

async function getFile(downloadUri: string): Promise<Blob> {
  try {
    const res = await fetch(downloadUri);
    if (res.ok) return await res.blob();
    throw new Error(`Adobe download failed (HTTP ${res.status})`);
  } catch {
    const body = await bridgeCall({ action: "get", url: downloadUri });
    if (!body) throw new Error("Adobe download returned an empty file.");
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
 * that waits for Adobe outlives the platform's execution limit and comes back
 * as an opaque 500.
 */
async function waitForJob(
  statusUrl: string,
  onProgress?: Progress,
  message?: string
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let delay = POLL_MIN_MS;
  let progress = 45;

  while (Date.now() < deadline) {
    const status = await postJson<StatusResponse>(
      adobeApiUrl("status"),
      { statusUrl },
      "Adobe conversion failed"
    );
    if (status.state === "done" && status.downloadUri) return status.downloadUri;

    progress = Math.min(progress + 4, 82);
    onProgress?.(progress, message);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.3), POLL_MAX_MS);
  }
  throw serviceErrorFromResponse(
    504,
    "Adobe PDF Services took too long to convert this file."
  );
}

export async function convertFileViaAdobe(options: {
  file: File;
  mediaType: string;
  kind: "pdf-to-word" | "word-to-pdf";
  onProgress?: Progress;
  uploadingMessage: string;
  convertingMessage: string;
}): Promise<{ blob: Blob; filename: string }> {
  options.onProgress?.(8, options.uploadingMessage);

  const asset = await postJson<AssetResponse>(
    adobeApiUrl("asset"),
    {
      filename: options.file.name,
      kind: options.kind === "word-to-pdf" ? "word" : "pdf",
    },
    "Could not start Adobe conversion"
  );
  if (!asset.assetID || !asset.uploadUri) {
    throw new Error("Adobe PDF Services did not return an upload URL.");
  }

  options.onProgress?.(20, options.uploadingMessage);
  await putFile(asset.uploadUri, options.file, asset.mediaType || options.mediaType);

  options.onProgress?.(45, options.convertingMessage);
  const job = await postJson<JobResponse>(
    adobeApiUrl("job"),
    { assetID: asset.assetID, filename: options.file.name, kind: options.kind },
    "Adobe conversion failed"
  );
  if (!job.statusUrl) {
    throw new Error("Adobe PDF Services did not return a job status URL.");
  }

  const downloadUri = await waitForJob(
    job.statusUrl,
    options.onProgress,
    options.convertingMessage
  );

  options.onProgress?.(88, "Preparing download…");
  const blob = await getFile(downloadUri);
  options.onProgress?.(100, "Done");
  return { blob, filename: job.filename };
}
