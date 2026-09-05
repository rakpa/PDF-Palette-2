import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Plugin } from "vite";
import { loadEnv } from "vite";

type NodeHandler = (req: unknown, res: unknown) => void | Promise<void>;

const ROUTES = ["health", "asset", "job", "status"] as const;

/**
 * Serves the same /api/convert/* serverless functions that Vercel runs, so local
 * `npm run dev` and production share one code path (and one set of bugs).
 */
export function convertApiPlugin(mode: string): Plugin {
  return {
    name: "pdf-palette-convert-api",
    configureServer(server) {
      // Let CLOUDCONVERT_API_KEY live in .env / .env.local for local development.
      const env = loadEnv(mode, process.cwd(), "");
      for (const key of Object.keys(env)) {
        if (!key.startsWith("VITE_") && process.env[key] === undefined) {
          process.env[key] = env[key];
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const match = /^\/api\/convert\/([a-z]+)\/?$/.exec(url);
        if (!match || !ROUTES.includes(match[1] as (typeof ROUTES)[number])) {
          next();
          return;
        }
        try {
          const file = path.resolve(process.cwd(), "api/convert", `${match[1]}.js`);
          const mod = (await import(pathToFileURL(file).href)) as {
            default: NodeHandler;
          };
          await mod.default(req, res);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Convert API dev handler failed",
            })
          );
        }
      });
    },
  };
}
