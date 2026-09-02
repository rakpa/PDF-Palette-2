import { createReadStream, cpSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Connect, Plugin } from "vite";
import { corpHeaders, prependMiddleware } from "./vite.crossOriginIsolation";

const root = path.dirname(fileURLToPath(import.meta.url));
const workerSrc = path.resolve(
  root,
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"
);
const workerUrlPath = "/pdf.worker.min.mjs";

function servePdfWorker(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url !== workerUrlPath) return next();
    if (!existsSync(workerSrc)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    corpHeaders(res);
    createReadStream(workerSrc).pipe(res);
  };
}

export function pdfjsWorkerPlugin(): Plugin {
  return {
    name: "pdfjs-worker-asset",
    enforce: "pre",
    configureServer(server) {
      prependMiddleware(server, servePdfWorker());
    },
    closeBundle() {
      if (!existsSync(workerSrc)) return;
      const distDir = path.resolve(root, "dist");
      mkdirSync(distDir, { recursive: true });
      cpSync(workerSrc, path.join(distDir, "pdf.worker.min.mjs"));
    },
  };
}
