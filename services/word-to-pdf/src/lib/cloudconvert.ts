const CC_BASE = "https://api.cloudconvert.com/v2";

export class CloudConvertError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500
  ) {
    super(message);
    this.name = "CloudConvertError";
  }
}

export function cloudConvertApiKey(config: { CLOUDCONVERT_API_KEY?: string }): string {
  return String(config.CLOUDCONVERT_API_KEY ?? "").trim();
}

export function cloudConvertConfigured(config: { CLOUDCONVERT_API_KEY?: string }): boolean {
  return Boolean(cloudConvertApiKey(config));
}

function requireKey(config: { CLOUDCONVERT_API_KEY?: string }): string {
  const key = cloudConvertApiKey(config);
  if (!key) {
    throw new CloudConvertError(
      "CloudConvert is not configured. Set CLOUDCONVERT_API_KEY.",
      503
    );
  }
  return key;
}

async function ccFetch(
  config: { CLOUDCONVERT_API_KEY?: string },
  url: string,
  init?: RequestInit
): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireKey(config)}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new CloudConvertError(
      body.message || body.error || `CloudConvert request failed (HTTP ${res.status})`,
      res.status === 401 || res.status === 403 ? 503 : 502
    );
  }
  return body.data || body;
}

export async function beginCloudConvertUpload(
  config: { CLOUDCONVERT_API_KEY?: string },
  inputFormat: "pdf" | "docx" | "doc",
  outputFormat: "pdf" | "docx"
): Promise<{
  jobId: string;
  uploadUrl: string;
  formParameters: Record<string, string | number>;
}> {
  const job = await ccFetch(config, `${CC_BASE}/jobs`, {
    method: "POST",
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
  const importTask = (job.tasks || []).find((task: { operation?: string }) => task.operation === "import/upload");
  const form = importTask?.result?.form;
  if (!job.id || !form?.url || !form.parameters) {
    throw new CloudConvertError("CloudConvert did not return an upload URL.", 502);
  }
  return { jobId: job.id, uploadUrl: form.url, formParameters: form.parameters };
}

export async function finishCloudConvertJob(
  config: { CLOUDCONVERT_API_KEY?: string },
  jobId: string
): Promise<{ downloadUri: string }> {
  const deadline = Date.now() + 5 * 60 * 1000;
  let delay = 1000;
  while (Date.now() < deadline) {
    const job = await ccFetch(config, `${CC_BASE}/jobs/${jobId}`);
    const status = String(job.status || "").toLowerCase();
    if (status === "finished") {
      const exportTask = (job.tasks || []).find((task: { operation?: string }) => task.operation === "export/url");
      const downloadUri = exportTask?.result?.files?.[0]?.url;
      if (!downloadUri) {
        throw new CloudConvertError("CloudConvert finished the job but returned no download URL.", 502);
      }
      return { downloadUri };
    }
    if (status === "error" || status === "failed") {
      const failed = (job.tasks || []).find((task: { status?: string }) => task.status === "error");
      throw new CloudConvertError(failed?.message || job.message || "CloudConvert could not convert this file.", 422);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  throw new CloudConvertError("CloudConvert took too long to convert this file.", 504);
}

export function mediaTypeForWord(filename: string): string {
  return /\.doc$/i.test(filename) && !/\.docx$/i.test(filename)
    ? "application/msword"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export function wordInputFormat(filename: string): "doc" | "docx" {
  return /\.doc$/i.test(filename) && !/\.docx$/i.test(filename) ? "doc" : "docx";
}

export async function convertPathWithCloudConvert(
  config: { CLOUDCONVERT_API_KEY?: string },
  filePath: string,
  outputPath: string,
  inputFormat: "pdf" | "docx" | "doc",
  outputFormat: "pdf" | "docx"
): Promise<{ downloadUri: string }> {
  const fs = await import("node:fs/promises");
  const created = await beginCloudConvertUpload(config, inputFormat, outputFormat);
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  for (const [key, value] of Object.entries(created.formParameters)) {
    form.append(key, String(value));
  }
  form.append("file", new Blob([bytes]), filePath.split(/[/\\]/).pop() || "file");
  const uploaded = await fetch(created.uploadUrl, { method: "POST", body: form });
  if (!uploaded.ok) {
    throw new CloudConvertError(`CloudConvert upload failed (HTTP ${uploaded.status})`, 502);
  }
  const result = await finishCloudConvertJob(config, created.jobId);
  const downloaded = await fetch(result.downloadUri);
  if (!downloaded.ok) {
    throw new CloudConvertError(`CloudConvert download failed (HTTP ${downloaded.status})`, 502);
  }
  await fs.writeFile(outputPath, Buffer.from(await downloaded.arrayBuffer()));
  return result;
}
