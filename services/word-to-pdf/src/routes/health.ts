import { Router } from "express";
import type { AppConfig } from "../config.js";
import { cloudConvertConfigured } from "../lib/cloudconvert.js";
import { checkLibreOfficeAvailable } from "../lib/libreoffice.js";

export function createHealthRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const cloudconvert = cloudConvertConfigured(config);
    const libreOfficeOk = await checkLibreOfficeAvailable(config);
    const ready = cloudconvert || libreOfficeOk;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      checks: { cloudconvert, libreOffice: libreOfficeOk },
      engine: cloudconvert ? "cloudconvert" : "libreoffice-headless",
      conversions: cloudconvert
        ? ["word-to-pdf", "pdf-to-word", "unlock-pdf", "protect-pdf", "html-to-pdf"]
        : ["word-to-pdf", "unlock-pdf", "protect-pdf", "html-to-pdf"],
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
