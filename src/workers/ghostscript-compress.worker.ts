/// <reference lib="webworker" />
import type { GhostscriptModule } from "@bentopdf/gs-wasm";
import type { CompressionLevel } from "@/lib/compression-types";

const GS_ASSETS_BASE = "/gs-wasm/";

const PDF_SETTINGS = {
  low: "/printer",
  recommended: "/screen",
  extreme: "/screen",
} as const satisfies Record<CompressionLevel, string>;

type WorkerRequest =
  | { type: "init"; id: string }
  | { type: "compress"; id: string; buffer: ArrayBuffer; level: CompressionLevel };

type WorkerResponse =
  | { type: "ready"; id: string }
  | { type: "progress"; id: string; progress: number }
  | { type: "result"; id: string; buffer: ArrayBuffer }
  | { type: "error"; id: string; message: string };

let gsModule: GhostscriptModule | null = null;
let gsPromise: Promise<GhostscriptModule> | null = null;

async function loadGhostscriptFromBase(baseUrl: string): Promise<GhostscriptModule> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const jsRes = await fetch(`${base}gs.js`);
  if (!jsRes.ok) {
    throw new Error(`Failed to load Ghostscript engine (${jsRes.status})`);
  }

  const blobUrl = URL.createObjectURL(
    new Blob([await jsRes.text()], { type: "application/javascript" })
  );

  try {
    const factory = (await import(/* @vite-ignore */ blobUrl)).default;
    return factory({
      locateFile: (file: string) =>
        file.endsWith(".wasm") ? `${base}gs.wasm` : `${base}${file}`,
    });
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function loadGhostscript(): Promise<GhostscriptModule> {
  if (gsModule) return Promise.resolve(gsModule);
  if (!gsPromise) {
    gsPromise = loadGhostscriptFromBase(GS_ASSETS_BASE).then((mod) => {
      gsModule = mod;
      return mod;
    });
  }
  return gsPromise;
}

function runCompress(gs: GhostscriptModule, buffer: ArrayBuffer, level: CompressionLevel): Uint8Array {
  const inputPath = "/input.pdf";
  const outputPath = "/output.pdf";

  const speedArgs =
    level === "recommended"
      ? [
          "-dColorImageResolution=120",
          "-dGrayImageResolution=120",
          "-dMonoImageResolution=150",
          "-dDownsampleColorImages=true",
          "-dDownsampleGrayImages=true",
          "-dDownsampleMonoImages=true",
        ]
      : [];

  try {
    gs.FS.writeFile(inputPath, new Uint8Array(buffer));

    const code = gs.callMain([
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=${PDF_SETTINGS[level]}`,
      "-dDetectDuplicateImages=true",
      "-dCompressFonts=true",
      "-dSubsetFonts=true",
      "-dAutoRotatePages=/None",
      ...speedArgs,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${outputPath}`,
      inputPath,
    ]);

    if (code !== 0) {
      throw new Error(`Ghostscript failed (exit code ${code})`);
    }

    return gs.FS.readFile(outputPath) as Uint8Array;
  } finally {
    try {
      gs.FS.unlink(inputPath);
    } catch {
      // ignore
    }
    try {
      gs.FS.unlink(outputPath);
    } catch {
      // ignore
    }
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "init") {
    void loadGhostscript()
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

  void (async () => {
    const post = (payload: WorkerResponse, transfer?: Transferable[]) => {
      self.postMessage(payload, transfer ?? []);
    };

    try {
      post({ type: "progress", id: msg.id, progress: 15 });
      const gs = await loadGhostscript();
      post({ type: "progress", id: msg.id, progress: 40 });

      const output = runCompress(gs, msg.buffer, msg.level);
      post({ type: "progress", id: msg.id, progress: 95 });
      post({ type: "result", id: msg.id, buffer: output.buffer }, [output.buffer]);
    } catch (error) {
      post({
        type: "error",
        id: msg.id,
        message: error instanceof Error ? error.message : "Compression failed",
      });
    }
  })();
});
