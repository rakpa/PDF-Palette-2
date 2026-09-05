import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Plugin } from "vite";
import { loadEnv } from "vite";

type NodeHandler = (req: unknown, res: unknown) => void | Promise<void>;

const ROUTES = ["health", "asset", "job", "status"] as const;

/**
 * Serves the same /api/adobe/* serverless functions that Vercel runs, so local
 * `npm run dev` and production share one code path (and one set of bugs).
 */
export function adobeApiPlugin(mode: string): Plugin {
  return {
    name: "pdf-palette-adobe-api",
    configureServer(server) {
      // Let PDF_SERVICES_* live in .env / .env.local for local development.
      const env = loadEnv(mode, process.cwd(), "");
      for (const key of Object.keys(env)) {
        if (!key.startsWith("VITE_") && process.env[key] === undefined) {
          process.env[key] = env[key];
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const match = /^\/api\/adobe\/([a-z]+)\/?$/.exec(url);
        if (!match || !ROUTES.includes(match[1] as (typeof ROUTES)[number])) {
          next();
          return;
        }
        try {
          const file = path.resolve(process.cwd(), "api/adobe", `${match[1]}.js`);
          const mod = (await import(pathToFileURL(file).href)) as {
            default: NodeHandler;
          };
          await mod.default(req, res);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Adobe API dev handler failed",
            })
          );
        }
      });
    },
  };
}
