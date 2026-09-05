import { Router } from "express";
import type { AppConfig } from "../config.js";
import { adobeConfigured } from "../lib/adobe-convert.js";
import { checkLibreOfficeAvailable } from "../lib/libreoffice.js";

export function createHealthRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const adobeOk = adobeConfigured(config);
    const libreOfficeOk = await checkLibreOfficeAvailable(config);
    const ready = adobeOk || libreOfficeOk;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ok" : "degraded",
      checks: { adobe: adobeOk, libreOffice: libreOfficeOk },
      engine: adobeOk ? "adobe-pdf-services" : "libreoffice-headless",
      conversions: adobeOk
        ? ["word-to-pdf", "pdf-to-word", "unlock-pdf", "protect-pdf", "html-to-pdf"]
        : ["word-to-pdf", "unlock-pdf", "protect-pdf", "html-to-pdf"],
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
