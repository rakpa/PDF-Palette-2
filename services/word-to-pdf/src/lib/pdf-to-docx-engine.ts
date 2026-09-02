import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

export class PdfToDocxEngineError extends Error {
  constructor(
    message: string,
    readonly code: "python_missing" | "deps_missing" | "timeout" | "conversion_failed"
  ) {
    super(message);
    this.name = "PdfToDocxEngineError";
  }
}

export type PdfToDocxEngineResult = {
  outputPath: string;
  pageCount: number;
  byteLength: number;
  pdfImageCount: number;
  docxImageCount: number;
  docxTableCount: number;
  ocrUsed: boolean;
  validationPassed?: boolean;
  textCoverage?: number;
  imageFallbackPages?: number[];
};

const SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const PYTHON_SCRIPT = path.join(SERVICE_ROOT, "python", "pdf_to_docx.py");

function parseConverterJson(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("empty converter output");

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const lines = trimmed.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{") && line.endsWith("}")) {
        return JSON.parse(line) as Record<string, unknown>;
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("converter output was not JSON");
  }
}

function resolvePythonCommand(config: AppConfig): string {
  return config.PYTHON_PATH?.trim() || (process.platform === "win32" ? "python" : "python3");
}

function killProcessTree(child: ReturnType<typeof spawn>, log: Logger): void {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  log.warn({ pid }, "pdf2docx process killed after timeout");
}

export async function convertPdfToDocxLayoutPreserving(
  inputPath: string,
  outputPath: string,
  config: AppConfig,
  log: Logger
): Promise<PdfToDocxEngineResult> {
  const python = resolvePythonCommand(config);

  try {
    await fs.access(PYTHON_SCRIPT);
  } catch {
    throw new PdfToDocxEngineError(
      `Conversion script not found at ${PYTHON_SCRIPT}`,
      "conversion_failed"
    );
  }

  log.info({ python, inputPath, outputPath }, "starting layout-preserving pdf2docx conversion");

  const result = await new Promise<PdfToDocxEngineResult>((resolve, reject) => {
    const child = spawn(python, [PYTHON_SCRIPT, inputPath, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      log.debug({ pdf2docx: line.trim() });
    });

    const timer = setTimeout(() => {
      killProcessTree(child, log);
      reject(
        new PdfToDocxEngineError(
          `PDF to Word conversion timed out after ${config.CONVERSION_TIMEOUT_MS}ms`,
          "timeout"
        )
      );
    }, config.CONVERSION_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (error.message.includes("ENOENT")) {
        reject(
          new PdfToDocxEngineError(
            "Python is not installed. Run: pip install -r services/word-to-pdf/python/requirements.txt",
            "python_missing"
          )
        );
        return;
      }
      reject(new PdfToDocxEngineError(error.message, "conversion_failed"));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        let message = stderr.trim() || `pdf2docx exited with code ${code}`;
        try {
          const parsed = parseConverterJson(stdout) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // use stderr
        }
        if (/No module named|pdf2docx|fitz|docx/i.test(message)) {
          reject(
            new PdfToDocxEngineError(
              "Python dependencies missing. Run: pip install -r services/word-to-pdf/python/requirements.txt",
              "deps_missing"
            )
          );
          return;
        }
        reject(new PdfToDocxEngineError(message, "conversion_failed"));
        return;
      }

      try {
        const payload = parseConverterJson(stdout) as {
          ok?: boolean;
          error?: string;
          output?: string;
          page_count?: number;
          byte_length?: number;
          pdf_image_count?: number;
          docx_image_count?: number;
          docx_table_count?: number;
          ocr_used?: boolean;
          validation?: { passed?: boolean; text_coverage?: number };
          build?: { image_fallback_pages?: number[] };
        };

        if (!payload.ok || !payload.output) {
          reject(
            new PdfToDocxEngineError(
              payload.error || "pdf2docx conversion failed",
              "conversion_failed"
            )
          );
          return;
        }

        resolve({
          outputPath: payload.output,
          pageCount: payload.page_count ?? 0,
          byteLength: payload.byte_length ?? 0,
          pdfImageCount: payload.pdf_image_count ?? 0,
          docxImageCount: payload.docx_image_count ?? 0,
          docxTableCount: payload.docx_table_count ?? 0,
          ocrUsed: Boolean(payload.ocr_used),
          validationPassed: payload.validation?.passed,
          textCoverage: payload.validation?.text_coverage,
          imageFallbackPages: payload.build?.image_fallback_pages,
        });
      } catch {
        reject(
          new PdfToDocxEngineError(
            "Invalid response from pdf2docx converter",
            "conversion_failed"
          )
        );
      }
    });
  });

  log.info(result, "layout-preserving conversion finished");
  return result;
}
