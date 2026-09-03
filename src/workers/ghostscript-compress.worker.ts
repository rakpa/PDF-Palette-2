/// <reference lib="webworker" />
import type { GhostscriptModule, GhostscriptModuleFactory } from "@bentopdf/gs-wasm";
import type { CompressionLevel } from "@/lib/compression-types";
import { buildGhostscriptArgs } from "@/lib/compress-args";

const GS_ASSETS_BASE = "/gs-wasm/";

type WorkerRequest =
  | { type: "init"; id: string }
  | { type: "compress"; id: string; buffer: ArrayBuffer; level: CompressionLevel };

type WorkerResponse =
  | { type: "ready"; id: string }
  | { type: "progress"; id: string; progress: number; status?: string }
  | { type: "result"; id: string; buffer: ArrayBuffer }
  | { type: "error"; id: string; message: string };

/**
 * The engine is loaded once (a 15 MB wasm download and compile) but *instantiated
 * per run*: Ghostscript's main() cannot be re-entered on a used instance, and a
 * fresh instance is also how the memory a big document took gets released.
 */
interface Engine {
  factory: GhostscriptModuleFactory;
  wasmModule: WebAssembly.Module;
}

let enginePromise: Promise<Engine> | null = null;

async function loadEngine(): Promise<Engine> {
  const base = GS_ASSETS_BASE.endsWith("/") ? GS_ASSETS_BASE : `${GS_ASSETS_BASE}/`;

  const [factory, wasmModule] = await Promise.all([
    loadFactory(base),
    compileWasm(`${base}gs.wasm`),
  ]);

  return { factory, wasmModule };
}

async function loadFactory(base: string): Promise<GhostscriptModuleFactory> {
  const jsRes = await fetch(`${base}gs.js`);
  if (!jsRes.ok) {
    throw new Error(`Failed to load Ghostscript engine (${jsRes.status})`);
  }

  const blobUrl = URL.createObjectURL(
    new Blob([await jsRes.text()], { type: "application/javascript" })
  );

  try {
    return (await import(/* @vite-ignore */ blobUrl)).default;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function compileWasm(url: string): Promise<WebAssembly.Module> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load Ghostscript engine (${res.status})`);
  }
  // compileStreaming needs an application/wasm response; fall back when a host
  // serves the file as octet-stream.
  if (res.headers.get("content-type")?.includes("application/wasm")) {
    try {
      return await WebAssembly.compileStreaming(res.clone());
    } catch {
      // fall through to the buffered path
    }
  }
  return WebAssembly.compile(await res.arrayBuffer());
}

function getEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = loadEngine().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

interface InstanceHooks {
  onStdout: (line: string) => void;
  onStderr: (line: string) => void;
}

function createInstance(engine: Engine, hooks: InstanceHooks): Promise<GhostscriptModule> {
  return engine.factory({
    locateFile: (file: string) => `${GS_ASSETS_BASE}${file}`,
    print: hooks.onStdout,
    printErr: hooks.onStderr,
    // Reuse the already-compiled module — instantiation is then near-instant.
    instantiateWasm: (
      imports: WebAssembly.Imports,
      success: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
    ) => {
      void WebAssembly.instantiate(engine.wasmModule, imports).then((instance) => {
        success(instance, engine.wasmModule);
      });
      return {};
    },
  } as Parameters<GhostscriptModuleFactory>[0]);
}

const INPUT_PATH = "/input.pdf";
const OUTPUT_PATH = "/output.pdf";

/** Ghostscript announces "Processing pages 1 through N." then "Page k" per page. */
const TOTAL_RE = /^Processing pages \d+ through (\d+)\.?$/;
const PAGE_RE = /^Page (\d+)$/;

const PAGE_PROGRESS_START = 12;
const PAGE_PROGRESS_END = 92;

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "init") {
    void getEngine()
      .then(() => {
        self.postMessage({ type: "ready", id: msg.id } satisfies WorkerResponse);
      })
      .catch((error) => {
        self.postMessage({
          type: "error",
          id: msg.id,
          message: error instanceof Error ? error.message : "Failed to load compression engine",
        } satisfies WorkerResponse);
      });
    return;
  }

  if (msg.type !== "compress") return;

  void runCompression(msg);
});

async function runCompression(msg: Extract<WorkerRequest, { type: "compress" }>): Promise<void> {
  const post = (payload: WorkerResponse, transfer?: Transferable[]) => {
    self.postMessage(payload, transfer ?? []);
  };
  const progress = (value: number, status?: string) =>
    post({ type: "progress", id: msg.id, progress: Math.round(value), status });

  let gs: GhostscriptModule | null = null;

  try {
    progress(4, "Loading compression engine…");
    const engine = await getEngine();

    let totalPages = 0;
    let lastPage = 0;
    let pagesWritten = 0;
    let needsPassword = false;
    const stderr: string[] = [];

    // Ghostscript writes a page line as each page lands in the output file, so
    // this reports real work even though callMain blocks this worker throughout.
    const onStdout = (line: string) => {
      const total = TOTAL_RE.exec(line);
      if (total) {
        totalPages = Number(total[1]);
        progress(PAGE_PROGRESS_START, `Compressing ${totalPages} page${totalPages === 1 ? "" : "s"}…`);
        return;
      }
      const page = PAGE_RE.exec(line);
      if (!page) return;
      lastPage = Number(page[1]);
      pagesWritten += 1;
      if (totalPages > 0) {
        const span = PAGE_PROGRESS_END - PAGE_PROGRESS_START;
        progress(
          PAGE_PROGRESS_START + (span * lastPage) / totalPages,
          `Compressing page ${lastPage} of ${totalPages}…`
        );
      } else {
        // Unknown length: approach the ceiling without ever reaching it.
        progress(
          PAGE_PROGRESS_START + (PAGE_PROGRESS_END - PAGE_PROGRESS_START) * (1 - 1 / (1 + lastPage / 20)),
          `Compressing page ${lastPage}…`
        );
      }
    };

    const onStderr = (line: string) => {
      if (!line.trim()) return;
      if (/requires a password/i.test(line)) needsPassword = true;
      stderr.push(line);
    };

    gs = await createInstance(engine, { onStdout, onStderr });

    progress(8, "Reading document…");
    gs.FS.writeFile(INPUT_PATH, new Uint8Array(msg.buffer));
    // The transferred copy is no longer needed once it is in the engine's FS.
    (msg as { buffer: ArrayBuffer | null }).buffer = null;

    progress(10, "Compressing…");
    const code = gs.callMain(buildGhostscriptArgs(msg.level, INPUT_PATH, OUTPUT_PATH));

    if (code !== 0) {
      throw new Error(describeFailure(code, stderr));
    }

    // Ghostscript exits 0 even when it wrote nothing usable — an encrypted or
    // damaged file yields a ~3 KB stub, which would otherwise be handed over as
    // a spectacular "99% reduction".
    if (needsPassword) {
      throw new Error(
        "This PDF is password-protected. Unlock it first, then compress it."
      );
    }
    if (pagesWritten === 0) {
      throw new Error(
        "No pages could be read from this PDF — the file looks damaged or is not a PDF."
      );
    }
    if (totalPages > 0 && pagesWritten < totalPages) {
      throw new Error(
        `This PDF is damaged: only ${pagesWritten} of its ${totalPages} pages could be read, ` +
          "so the compressed copy would be incomplete."
      );
    }

    progress(94, "Writing compressed file…");
    const output = gs.FS.readFile(OUTPUT_PATH) as Uint8Array;
    if (output.length === 0) {
      throw new Error("Ghostscript produced an empty file");
    }

    // Detach from the engine's filesystem before the instance is dropped.
    const buffer = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    cleanup(gs);
    gs = null;

    progress(98);
    post({ type: "result", id: msg.id, buffer }, [buffer]);
  } catch (error) {
    if (gs) cleanup(gs);
    post({
      type: "error",
      id: msg.id,
      message: describeError(error),
    });
  }
}

function cleanup(gs: GhostscriptModule): void {
  for (const path of [INPUT_PATH, OUTPUT_PATH]) {
    try {
      gs.FS.unlink(path);
    } catch {
      // never existed, or the instance is already gone
    }
  }
}

function describeFailure(code: number, stderr: string[]): string {
  const detail = stderr
    .filter((line) => !/^GPL Ghostscript|^Copyright|^This software|^see the file/.test(line))
    .slice(-3)
    .join(" ")
    .trim();
  if (/password|encrypt/i.test(detail)) {
    return "This PDF is password-protected — unlock it first, then compress.";
  }
  return detail
    ? `Ghostscript could not process this PDF: ${detail}`
    : `Ghostscript failed (exit code ${code})`;
}

function describeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Compression failed";
  if (/out of memory|allocation|OOM|Aborted/i.test(message)) {
    return "Ran out of memory compressing this PDF. Try splitting it into smaller files first.";
  }
  return message;
}
