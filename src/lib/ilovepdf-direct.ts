type Progress = (progress: number, message?: string) => void;

type StartResponse = {
  engine: "ilovepdf" | "browser";
  reason?: string;
  token?: string;
  server?: string;
  task?: string;
  tool?: string;
  uploadUrl?: string;
  filename?: string;
};

type ProcessResponse = {
  engine: "ilovepdf" | "browser";
  reason?: string;
  downloadUrl?: string;
  token?: string;
  filename?: string;
};

type BridgeResult = {
  ok?: boolean;
  error?: string;
  text?: string;
  body?: ArrayBuffer;
};

function iloveApiUrl(name: "health" | "start" | "process"): string {
  return `/api/ilove/${name}`;
}

function outputFilename(name: string): string {
  return `${name.replace(/\.pdf$/i, "") || "document"}.docx`;
}

async function throwHttpError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) message = data.error;
    else message = `${fallback} (HTTP ${res.status})`;
  } catch {
    message = `${fallback} (HTTP ${res.status})`;
  }
  throw new Error(message);
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwHttpError(res, fallback);
  return (await res.json()) as T;
}

function bridgeCall(payload: Record<string, unknown>): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = "/convert-bridge.html";
    iframe.style.display = "none";
    const id = `ilove-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("iLovePDF transfer timed out."));
    }, 5 * 60 * 1000);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as BridgeResult & { type?: string; id?: string };
      if (data?.type !== "convert-transfer-result" || data.id !== id) return;
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "iLovePDF transfer failed."));
        return;
      }
      resolve(data);
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
      reject(new Error("Could not open the iLovePDF transfer bridge."));
    });
    document.body.appendChild(iframe);
  });
}

async function uploadFile(
  uploadUrl: string,
  file: File,
  task: string,
  token: string
): Promise<string> {
  const parameters = { task };
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const form = new FormData();
    form.append("task", task);
    form.append("file", file);
    const res = await fetch(uploadUrl, { method: "POST", headers, body: form });
    if (res.ok) {
      const body = (await res.json()) as { server_filename?: string };
      if (body.server_filename) return body.server_filename;
    }
  } catch {
    // COEP / CORS: fall through to the convert-bridge iframe.
  }
  const result = await bridgeCall({
    action: "post",
    url: uploadUrl,
    parameters,
    headers,
    body: file,
  });
  const body = JSON.parse(result.text || "{}") as { server_filename?: string };
  if (!body.server_filename) {
    throw new Error("iLovePDF upload did not return a file name.");
  }
  return body.server_filename;
}

async function downloadFile(downloadUrl: string, token: string): Promise<Blob> {
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const res = await fetch(downloadUrl, { headers });
    if (res.ok) return await res.blob();
  } catch {
    // COEP / CORS: fall through to the convert-bridge iframe.
  }
  const result = await bridgeCall({ action: "get", url: downloadUrl, headers });
  if (!result.body) throw new Error("iLovePDF download returned an empty file.");
  return new Blob([result.body]);
}

export async function convertPdfToWordIlove(
  file: File,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" | "browser" }> {
  onProgress?.(8, "Starting iLovePDF…");
  const start = await postJson<StartResponse>(
    iloveApiUrl("start"),
    { filename: file.name },
    "Could not start iLovePDF conversion"
  );

  if (start.engine !== "ilovepdf" || !start.uploadUrl || !start.task || !start.token) {
    throw new Error(start.reason || "iLovePDF did not start a PDF to Word task.");
  }

  onProgress?.(22, "Uploading PDF to iLovePDF…");
  const serverFilename = await uploadFile(start.uploadUrl, file, start.task, start.token);

  onProgress?.(48, "Converting with iLovePDF…");
  const processed = await postJson<ProcessResponse>(
    iloveApiUrl("process"),
    {
      server: start.server,
      task: start.task,
      tool: start.tool,
      serverFilename,
      filename: file.name,
      token: start.token,
    },
    "iLovePDF conversion failed"
  );

  if (processed.engine !== "ilovepdf" || !processed.downloadUrl) {
    throw new Error(processed.reason || "iLovePDF did not return a Word file.");
  }
  const downloadToken = processed.token || start.token;

  onProgress?.(88, "Downloading Word file…");
  const blob = await downloadFile(processed.downloadUrl, downloadToken);
  onProgress?.(100, "Done");
  return {
    blob,
    filename: start.filename || outputFilename(file.name),
    engine: "ilovepdf",
  };
}
