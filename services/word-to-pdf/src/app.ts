import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { createWordToPdfRouter } from "./routes/word-to-pdf.js";
import { createPdfToWordRouter } from "./routes/pdf-to-word.js";
import { createHealthRouter } from "./routes/health.js";
import { createUnlockPdfRouter } from "./routes/unlock-pdf.js";
import { createProtectPdfRouter } from "./routes/protect-pdf.js";
import { createHtmlToPdfRouter } from "./routes/html-to-pdf.js";

export function createApp(config: AppConfig, log: Logger) {
  const app = express();

  const allowedOrigins = new Set(
    config.CORS_ORIGIN.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
  if (process.env.VERCEL_URL) {
    allowedOrigins.add(`https://${process.env.VERCEL_URL}`);
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      methods: ["GET", "POST", "OPTIONS"],
    })
  );

  app.use(
    pinoHttp({
      logger: log,
      autoLogging: {
        ignore: (req: { url?: string }) => {
          const url = req.url ?? "";
          return url === "/health" || url === "/_/word-to-pdf/health";
        },
      },
    })
  );

  const api = express.Router();
  api.use(createHealthRouter(config));
  api.use("/v1/word-to-pdf", createWordToPdfRouter(config, log));
  api.use("/v1/pdf-to-word", createPdfToWordRouter(config, log));
  api.use("/v1/unlock-pdf", createUnlockPdfRouter(config, log));
  api.use("/v1/protect-pdf", createProtectPdfRouter(config, log));
  api.use("/v1/html-to-pdf", createHtmlToPdfRouter(config, log));

  // Local: /v1/...  Vercel services: original public path /_/word-to-pdf/v1/...
  app.use(api);
  app.use("/_/word-to-pdf", api);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      log.error({ error: error.message }, "unhandled error");
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
