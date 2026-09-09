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

type ConvertKind = "pdf-to-word" | "word-to-pdf" | "html-to-pdf" | "pdf-to-ppt" | "ocr-pdf";

function outputFilename(name: string, kind: ConvertKind): string {
  if (kind === "word-to-pdf" || kind === "html-to-pdf" || kind === "ocr-pdf") {
    if (kind === "html-to-pdf") {
      try {
        const host = new URL(name).hostname.replace(/^www\./, "") || "page";
        return `${host.replace(/[^a-z0-9._-]+/gi, "-") || "page"}.pdf`;
      } catch {
        return "page.pdf";
      }
    }
    return `${name.replace(/\.pdf$/i, "").replace(/\.docx?$/i, "") || "document"}.pdf`;
  }
  if (kind === "pdf-to-ppt") {
    return `${name.replace(/\.pdf$/i, "") || "document"}.pptx`;
  }
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
      reject(new Error("Transfer timed out."));
    }, 5 * 60 * 1000);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as BridgeResult & { type?: string; id?: string };
      if (data?.type !== "convert-transfer-result" || data.id !== id) return;
      cleanup();
      if (!data.ok) {
        reject(new Error(data.error || "Transfer failed."));
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
      reject(new Error("Could not open the transfer bridge."));
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
    throw new Error("Upload did not return a file name.");
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
  if (!result.body) throw new Error("Download returned an empty file.");
  return new Blob([result.body]);
}

async function convertViaIlove(
  file: File,
  kind: ConvertKind,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" }> {
  const missing =
    kind === "word-to-pdf"
      ? "Could not start a Word to PDF task."
      : kind === "pdf-to-ppt"
        ? "Could not start a PDF to PowerPoint task."
        : kind === "ocr-pdf"
          ? "Could not start an OCR task."
          : "Could not start a PDF to Word task.";
  const empty =
    kind === "word-to-pdf"
      ? "Conversion did not return a PDF."
      : kind === "pdf-to-ppt"
        ? "Conversion did not return a PowerPoint file."
        : kind === "ocr-pdf"
          ? "OCR did not return a PDF."
          : "Conversion did not return a Word file.";

  onProgress?.(8, kind === "ocr-pdf" ? "Recognising…" : "Converting…");
  const start = await postJson<StartResponse>(
    iloveApiUrl("start"),
    { filename: file.name, kind },
    kind === "ocr-pdf" ? "Could not start OCR" : "Could not start conversion"
  );

  if (start.engine !== "ilovepdf" || !start.uploadUrl || !start.task || !start.token) {
    throw new Error(start.reason || missing);
  }

  onProgress?.(22, kind === "ocr-pdf" ? "Recognising…" : "Converting…");
  const serverFilename = await uploadFile(start.uploadUrl, file, start.task, start.token);

  onProgress?.(48, kind === "ocr-pdf" ? "Recognising…" : "Converting…");
  const processed = await postJson<ProcessResponse>(
    iloveApiUrl("process"),
    {
      kind,
      server: start.server,
      task: start.task,
      tool: start.tool,
      serverFilename,
      filename: file.name,
      token: start.token,
    },
    kind === "ocr-pdf" ? "OCR failed" : "Conversion failed"
  );

  if (processed.engine !== "ilovepdf" || !processed.downloadUrl) {
    throw new Error(processed.reason || empty);
  }
  const downloadToken = processed.token || start.token;

  onProgress?.(88, kind === "ocr-pdf" ? "Preparing download…" : "Converting…");
  const blob = await downloadFile(processed.downloadUrl, downloadToken);
  onProgress?.(100, kind === "ocr-pdf" ? "Done" : "Converting…");
  return {
    blob,
    filename: start.filename || outputFilename(file.name, kind),
    engine: "ilovepdf",
  };
}

type HtmlUrlStartResponse = StartResponse & { serverFilename?: string };

/** Convert a public web page URL to PDF (server fetches the page; no HTML file upload). */
export async function convertHtmlUrlToPdfIlove(
  url: string,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" }> {
  const pageUrl = url.trim();
  if (!pageUrl) throw new Error("Provide a page URL.");

  onProgress?.(8, "Fetching page…");
  const start = await postJson<HtmlUrlStartResponse>(
    iloveApiUrl("start"),
    { kind: "html-to-pdf", url: pageUrl },
    "Could not start conversion"
  );

  if (
    start.engine !== "ilovepdf" ||
    !start.serverFilename ||
    !start.task ||
    !start.token ||
    !start.server ||
    !start.tool
  ) {
    throw new Error(start.reason || "Could not start an HTML to PDF task.");
  }

  onProgress?.(45, "Rendering page…");
  const processed = await postJson<ProcessResponse>(
    iloveApiUrl("process"),
    {
      kind: "html-to-pdf",
      server: start.server,
      task: start.task,
      tool: start.tool,
      serverFilename: start.serverFilename,
      filename: "page.html",
      token: start.token,
    },
    "Conversion failed"
  );

  if (processed.engine !== "ilovepdf" || !processed.downloadUrl) {
    throw new Error(processed.reason || "Conversion did not return a PDF.");
  }

  onProgress?.(88, "Preparing download…");
  const blob = await downloadFile(processed.downloadUrl, processed.token || start.token);
  onProgress?.(100, "Done");
  return {
    blob,
    filename: start.filename || outputFilename(pageUrl, "html-to-pdf"),
    engine: "ilovepdf",
  };
}

export async function convertPdfToWordIlove(
  file: File,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" }> {
  return convertViaIlove(file, "pdf-to-word", onProgress);
}

export async function convertWordToPdfIlove(
  file: File,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" }> {
  return convertViaIlove(file, "word-to-pdf", onProgress);
}

export async function convertPdfToPptIlove(
  file: File,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" }> {
  return convertViaIlove(file, "pdf-to-ppt", onProgress);
}

export async function convertPdfOcrIlove(
  file: File,
  onProgress?: Progress
): Promise<{ blob: Blob; filename: string; engine: "ilovepdf" }> {
  return convertViaIlove(file, "ocr-pdf", onProgress);
}
