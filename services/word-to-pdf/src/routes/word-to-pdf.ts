import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { TempWorkspace } from "../lib/temp-workspace.js";
import { streamWordUpload, UploadError } from "../lib/streaming-upload.js";
import { AdobeConversionError } from "../lib/adobe-pdf-services.js";
import { adobeConfigured, convertWordToPdfAdobe } from "../lib/adobe-convert.js";
import { runWordToPdfConversion } from "../lib/convert.js";

export function createWordToPdfRouter(config: AppConfig, log: Logger): Router {
  const router = Router();

  router.post("/convert", async (req, res) => {
    const workspace = new TempWorkspace(config.TEMP_ROOT);
    const requestLog = log.child({ workspaceId: workspace.id });

    try {
      await workspace.init();
      requestLog.info("streaming upload started");

      const upload = await streamWordUpload(req, workspace.inputDir, config.MAX_UPLOAD_BYTES);
      requestLog.info(
        { originalName: upload.originalName, bytes: upload.byteLength },
        "upload complete"
      );

      const useAdobe = adobeConfigured(config);
      const adobeOutputPath = path.join(workspace.outputDir, "converted.pdf");
      const result = useAdobe
        ? {
            ...(await convertWordToPdfAdobe(
              upload.filePath,
              adobeOutputPath,
              upload.originalName,
              config,
              requestLog
            )),
            outputPath: adobeOutputPath,
          }
        : await runWordToPdfConversion(
            upload.filePath,
            workspace.outputDir,
            workspace.profileDir,
            upload.originalName,
            config,
            requestLog
          );

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${result.pdfFilename}"`);
      res.setHeader("X-Page-Count", String(result.pageCount));
      res.setHeader("X-Conversion-Engine", useAdobe ? "adobe-pdf-services" : "libreoffice-headless");

      const stream = fs.createReadStream(result.outputPath);

      let cleaned = false;
      const cleanupOnce = () => {
        if (cleaned) return;
        cleaned = true;
        void workspace.cleanup(requestLog);
      };

      stream.on("end", cleanupOnce);
      stream.on("error", (error) => {
        requestLog.error({ error }, "failed to stream pdf response");
        cleanupOnce();
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream converted PDF." });
        }
      });

      stream.pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversion failed";
      const status =
        error instanceof UploadError
          ? error.statusCode
          : error instanceof AdobeConversionError
            ? error.statusCode
          : /password|encrypt/i.test(message)
            ? 422
            : /corrupt|valid/i.test(message)
              ? 422
              : /timeout/i.test(message)
                ? 504
                : 500;

      requestLog.error({ error: message, status }, "conversion request failed");
      await workspace.cleanup(requestLog);
      if (!res.headersSent) {
        res.status(status).json({ error: message });
      }
    }
  });

  return router;
}
