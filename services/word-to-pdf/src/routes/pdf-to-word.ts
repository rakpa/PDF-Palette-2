import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { TempWorkspace } from "../lib/temp-workspace.js";
import { streamPdfUpload, UploadError } from "../lib/streaming-upload.js";
import {
  CloudConvertError,
  beginCloudConvertUpload,
  convertPathWithCloudConvert,
  finishCloudConvertJob,
} from "../lib/cloudconvert.js";

export function createPdfToWordRouter(config: AppConfig, log: Logger): Router {
  const router = Router();

  router.post("/asset", async (req, res) => {
    try {
      const created = await beginCloudConvertUpload(config, "pdf", "docx");
      res.json({ ...created, mediaType: "application/pdf" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start upload";
      const status = error instanceof CloudConvertError ? error.statusCode : 500;
      log.error({ error: message }, "pdf-to-word asset create failed");
      res.status(status).json({ error: message });
    }
  });

  router.post("/jobs", async (req, res) => {
    const jobId = typeof req.body?.jobId === "string" ? req.body.jobId.trim() : "";
    const filename = typeof req.body?.filename === "string" ? req.body.filename : "document.pdf";
    if (!jobId) {
      res.status(400).json({ error: "jobId is required." });
      return;
    }
    try {
      const result = await finishCloudConvertJob(config, jobId);
      const base = filename.replace(/\.pdf$/i, "") || "document";
      res.setHeader("X-Conversion-Engine", "cloudconvert");
      res.json({
        downloadUri: result.downloadUri,
        filename: `${base}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversion failed";
      const status = error instanceof CloudConvertError ? error.statusCode : 500;
      log.error({ error: message, status }, "pdf-to-word job failed");
      res.status(status).json({ error: message });
    }
  });

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
      const result = await convertPathWithCloudConvert(
        config,
        upload.filePath,
        outputPath,
        "pdf",
        "docx"
      );
      const docxFilename = (upload.originalName.replace(/\.pdf$/i, "") || "document") + ".docx";

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${docxFilename}"`);
      res.setHeader("X-Conversion-Engine", "cloudconvert");

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
          : error instanceof CloudConvertError
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
