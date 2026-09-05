import "dotenv/config";
import express from "express";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createApp } from "./app.js";

function fallbackApp(message: string) {
  const app = express();
  app.use((_req, res) => {
    res.status(500).json({ error: message });
  });
  return app;
}

let app: express.Express;
try {
  const appConfig = loadConfig();
  const log = createLogger(appConfig);
  app = createApp(appConfig, log);
  if (!process.env.VERCEL) {
    app.listen(appConfig.PORT, () => {
      log.info({ port: appConfig.PORT }, "word-to-pdf API listening");
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Conversion service failed to start";
  console.error("word-to-pdf failed to start:", message);
  app = fallbackApp(message);
}

export default app;
