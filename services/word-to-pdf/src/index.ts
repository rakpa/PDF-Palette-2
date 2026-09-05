import "dotenv/config";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createApp } from "./app.js";

const appConfig = loadConfig();
const log = createLogger(appConfig);
const app = createApp(appConfig, log);

// Local dev only — Vercel imports the default export as a serverless handler.
if (!process.env.VERCEL) {
  app.listen(appConfig.PORT, () => {
    log.info({ port: appConfig.PORT }, "word-to-pdf API listening");
  });
}

export const config = {
  api: { bodyParser: false },
  maxDuration: 300,
};

export default app;
