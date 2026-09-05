import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import { TempWorkspace } from "../lib/temp-workspace.js";
import { streamWordUpload, UploadError } from "../lib/streaming-upload.js";
import {
  CloudConvertError,
  beginCloudConvertUpload,
  convertPathWithCloudConvert,
  finishCloudConvertJob,
  mediaTypeForWord,
  wordInputFormat,
} from "../lib/cloudconvert.js";
export function createWordToPdfRouter(config: AppConfig, log: Logger): Router {
  const router = Router();

  router.post("/asset", async (req, res) => {
    try {
      const filename = typeof req.body?.filename === "string" ? req.body.filename : "document.docx";
      const created = await beginCloudConvertUpload(config, wordInputFormat(filename), "pdf");
      res.json({ ...created, mediaType: mediaTypeForWord(filename) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start upload";
      const status = error instanceof CloudConvertError ? error.statusCode : 500;
      log.error({ error: message }, "word-to-pdf asset create failed");
      res.status(status).json({ error: message });
    }
  });

  router.post("/jobs", async (req, res) => {
    const jobId = typeof req.body?.jobId === "string" ? req.body.jobId.trim() : "";
    const filename = typeof req.body?.filename === "string" ? req.body.filename : "document.docx";
    if (!jobId) {
      res.status(400).json({ error: "jobId is required." });
      return;
    }
    try {
      const result = await finishCloudConvertJob(config, jobId);
      const base = filename.replace(/\.docx?$/i, "") || "document";
      res.setHeader("X-Conversion-Engine", "cloudconvert");
      res.json({
        downloadUri: result.downloadUri,
        filename: `${base}.pdf`,
        contentType: "application/pdf",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversion failed";
      const status = error instanceof CloudConvertError ? error.statusCode : 500;
      log.error({ error: message, status }, "word-to-pdf job failed");
      res.status(status).json({ error: message });
    }
  });

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

      const outputPath = path.join(workspace.outputDir, "converted.pdf");
      await convertPathWithCloudConvert(
        config,
        upload.filePath,
        outputPath,
        wordInputFormat(upload.originalName),
        "pdf"
      );
      const result = {
        outputPath,
        pdfFilename: (upload.originalName.replace(/\.docx?$/i, "") || "document") + ".pdf",
        pageCount: 0,
      };

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${result.pdfFilename}"`);
      res.setHeader("X-Conversion-Engine", "cloudconvert");

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
          : error instanceof CloudConvertError
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
