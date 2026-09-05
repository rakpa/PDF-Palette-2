import express from "express";
import { loadConfig } from "./config.js";
import { AdobeConversionError, ADOBE_MEDIA } from "./lib/adobe-pdf-services.js";
import {
  adobeConfigured,
  beginAdobeUpload,
  finishAdobeJob,
  mediaTypeForWord,
} from "./lib/adobe-convert.js";

const config = loadConfig();
const app = express();
app.use(express.json({ limit: "32kb" }));

const log = {
  info: (obj: unknown, msg?: string) => console.log(msg ?? "", obj),
  error: (obj: unknown, msg?: string) => console.error(msg ?? "", obj),
  child: () => log,
};

function sendError(res: express.Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  const status = error instanceof AdobeConversionError ? error.statusCode : 500;
  res.status(status).json({ error: message });
}

function createApi(): express.Router {
  const router = express.Router();

  router.get(["/", "/health"], (_req, res) => {
    const adobe = adobeConfigured(config);
    res.status(adobe ? 200 : 503).json({
      status: adobe ? "ok" : "degraded",
      checks: { adobe },
      engine: adobe ? "adobe-pdf-services" : "unconfigured",
      conversions: adobe ? ["word-to-pdf", "pdf-to-word"] : [],
      timestamp: new Date().toISOString(),
    });
  });

  router.post("/v1/pdf-to-word/asset", async (_req, res) => {
    try {
      res.json(await beginAdobeUpload(config, ADOBE_MEDIA.pdf));
    } catch (error) {
      sendError(res, error, "Could not start Adobe conversion");
    }
  });

  router.post("/v1/word-to-pdf/asset", async (req, res) => {
    try {
      const filename = typeof req.body?.filename === "string" ? req.body.filename : "document.docx";
      res.json(await beginAdobeUpload(config, mediaTypeForWord(filename)));
    } catch (error) {
      sendError(res, error, "Could not start Adobe conversion");
    }
  });

  router.post("/v1/pdf-to-word/jobs", async (req, res) => {
    try {
      const assetID = typeof req.body?.assetID === "string" ? req.body.assetID.trim() : "";
      const filename = typeof req.body?.filename === "string" ? req.body.filename : "document.pdf";
      if (!assetID) {
        res.status(400).json({ error: "assetID is required." });
        return;
      }
      res.json(
        await finishAdobeJob(config, log as never, {
          assetID,
          filename,
          operation: "exportpdf",
        })
      );
    } catch (error) {
      sendError(res, error, "Adobe conversion failed");
    }
  });

  router.post("/v1/word-to-pdf/jobs", async (req, res) => {
    try {
      const assetID = typeof req.body?.assetID === "string" ? req.body.assetID.trim() : "";
      const filename = typeof req.body?.filename === "string" ? req.body.filename : "document.docx";
      if (!assetID) {
        res.status(400).json({ error: "assetID is required." });
        return;
      }
      res.json(
        await finishAdobeJob(config, log as never, {
          assetID,
          filename,
          operation: "createpdf",
        })
      );
    } catch (error) {
      sendError(res, error, "Adobe conversion failed");
    }
  });

  return router;
}

const api = createApi();
app.use(api);
app.use("/_/word-to-pdf", api);
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
