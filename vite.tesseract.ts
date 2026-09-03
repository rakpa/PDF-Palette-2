import { createReadStream, cpSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Connect, Plugin } from "vite";
import { corpHeaders, prependMiddleware } from "./vite.crossOriginIsolation";

const root = path.dirname(fileURLToPath(import.meta.url));

const workerSrc = path.resolve(root, "node_modules/tesseract.js/dist/worker.min.js");
const coreSrc = path.resolve(root, "node_modules/tesseract.js-core");
const langSrc = path.resolve(
  root,
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"
);

const distRoot = path.resolve(root, "dist/tesseract");

/**
 * LSTM-only cores. tesseract.js picks among these from SIMD support; the
 * matching `.wasm.js` is a single-file build, so the separate `.wasm` is not
 * requested.
 */
const CORE_FILES = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
] as const;

function contentType(file: string): string {
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".gz")) return "application/gzip";
  if (file.endsWith(".js")) return "application/javascript";
  return "application/octet-stream";
}

function resolveAsset(url: string): string | null {
  const clean = url.split("?")[0] ?? "";
  if (clean === "/tesseract/worker.min.js") return workerSrc;
  if (clean === "/tesseract/lang/eng.traineddata.gz") return langSrc;

  const corePrefix = "/tesseract/core/";
  if (!clean.startsWith(corePrefix)) return null;
  const name = path.basename(clean);
  if (!CORE_FILES.includes(name as (typeof CORE_FILES)[number])) return null;
  return path.join(coreSrc, name);
}

/** Dev-only: serve Tesseract worker, cores and language data with CORP. */
function serveTesseractAssets(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split("?")[0] ?? "";
    if (!url.startsWith("/tesseract/")) return next();

    const filePath = resolveAsset(url);
    if (!filePath || !existsSync(filePath)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("Content-Type", contentType(path.basename(filePath)));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    corpHeaders(res);
    createReadStream(filePath).pipe(res);
  };
}

function copyTesseractToDist(): void {
  mkdirSync(path.join(distRoot, "core"), { recursive: true });
  mkdirSync(path.join(distRoot, "lang"), { recursive: true });

  if (existsSync(workerSrc)) {
    cpSync(workerSrc, path.join(distRoot, "worker.min.js"));
  }
  for (const file of CORE_FILES) {
    const src = path.join(coreSrc, file);
    if (existsSync(src)) cpSync(src, path.join(distRoot, "core", file));
  }
  if (existsSync(langSrc)) {
    cpSync(langSrc, path.join(distRoot, "lang", "eng.traineddata.gz"));
  }
}

export function tesseractAssetsPlugin(): Plugin {
  return {
    name: "tesseract-assets",
    enforce: "pre",
    configureServer(server) {
      prependMiddleware(server, serveTesseractAssets());
    },
    closeBundle() {
      copyTesseractToDist();
    },
  };
}
