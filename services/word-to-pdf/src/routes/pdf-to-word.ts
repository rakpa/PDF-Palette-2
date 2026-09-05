import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { TempWorkspace } from "../lib/temp-workspace.js";
import { streamPdfUpload, UploadError } from "../lib/streaming-upload.js";
import { AdobeConversionError } from "../lib/adobe-pdf-services.js";
import { convertPdfToWordAdobe } from "../lib/adobe-convert.js";

export function createPdfToWordRouter(config: AppConfig, log: Logger): Router {
  const router = Router();

  router.post("/convert", async (req, res) => {
    const workspace = new TempWorkspace(config.TEMP_ROOT);
    const requestLog = log.child({ workspaceId: workspace.id });

    try {
      await workspace.init();
      requestLog.info("streaming pdf upload started");

      const upload = await streamPdfUpload(req, workspace.inputDir, config.MAX_UPLOAD_BYTES);
      requestLog.info(
        { originalName: upload.originalName, bytes: upload.byteLength },
        "upload complete"
      );

      const outputPath = path.join(workspace.outputDir, "converted.docx");
      const result = await convertPdfToWordAdobe(
        upload.filePath,
        outputPath,
        upload.originalName,
        config,
        requestLog
      );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${result.docxFilename}"`);
      res.setHeader("X-Conversion-Engine", "adobe-pdf-services");

      const stream = fs.createReadStream(outputPath);

      let cleaned = false;
      const cleanupOnce = () => {
        if (cleaned) return;
        cleaned = true;
        void workspace.cleanup(requestLog);
      };

      stream.on("end", cleanupOnce);
      stream.on("error", (error) => {
        requestLog.error({ error }, "failed to stream docx response");
        cleanupOnce();
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream converted Word document." });
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

      requestLog.error({ error: message, status }, "pdf-to-word request failed");
      await workspace.cleanup(requestLog);
      if (!res.headersSent) {
        res.status(status).json({ error: message });
      }
    }
  });

  return router;
}
