import { Router } from "express";
import type { AppConfig } from "../config.js";
import { checkLibreOfficeAvailable } from "../lib/libreoffice.js";

export function createHealthRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const libreOfficeOk = await checkLibreOfficeAvailable(config);

    res.status(libreOfficeOk ? 200 : 503).json({
      status: libreOfficeOk ? "ok" : "degraded",
      checks: { libreOffice: libreOfficeOk },
      engine: "libreoffice-headless",
      // PDF → Word runs in the browser and needs nothing from this service.
      conversions: ["word-to-pdf", "unlock-pdf", "protect-pdf", "html-to-pdf"],
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
