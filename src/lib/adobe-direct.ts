import {
  serviceErrorFromFetch,
  serviceErrorFromResponse,
} from "./conversion-service-client";

type Progress = (progress: number, message?: string) => void;

type AssetResponse = {
  assetID: string;
  uploadUri: string;
  mediaType: string;
};

type JobResponse = {
  downloadUri: string;
  filename: string;
  contentType: string;
};

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

export async function convertFileViaAdobe(options: {
  file: File;
  mediaType: string;
  assetUrl: string;
  jobsUrl: string;
  onProgress?: Progress;
  uploadingMessage: string;
  convertingMessage: string;
}): Promise<{ blob: Blob; filename: string }> {
  options.onProgress?.(8, options.uploadingMessage);
  let assetRes: Response;
  try {
    assetRes = await fetch(options.assetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: options.file.name, mediaType: options.mediaType }),
    });
  } catch (error) {
    throw serviceErrorFromFetch(error);
  }
  if (!assetRes.ok) {
    await throwHttpError(assetRes, "Could not start Adobe conversion");
  }
  const asset = (await assetRes.json()) as AssetResponse;
  if (!asset.assetID || !asset.uploadUri) {
    throw new Error("Adobe PDF Services did not return an upload URL.");
  }

  options.onProgress?.(20, options.uploadingMessage);
  await putFile(asset.uploadUri, options.file, asset.mediaType || options.mediaType);

  options.onProgress?.(45, options.convertingMessage);
  let jobRes: Response;
  try {
    jobRes = await fetch(options.jobsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetID: asset.assetID, filename: options.file.name }),
    });
  } catch (error) {
    throw serviceErrorFromFetch(error);
  }
  if (!jobRes.ok) {
    await throwHttpError(jobRes, "Adobe conversion failed");
  }
  const job = (await jobRes.json()) as JobResponse;
  if (!job.downloadUri) {
    throw new Error("Adobe PDF Services did not return a download URL.");
  }

  options.onProgress?.(85, "Preparing download…");
  const blob = await getFile(job.downloadUri);
  options.onProgress?.(100, "Done");
  return { blob, filename: job.filename };
}
