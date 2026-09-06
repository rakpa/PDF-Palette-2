import { pathToFileURL } from "node:url";
import path from "node:path";
import type { Plugin } from "vite";
import { loadEnv } from "vite";

type NodeHandler = (req: unknown, res: unknown) => void | Promise<void>;

const CONVERT_ROUTES = ["health", "asset", "job", "status"] as const;
const ILOVE_ROUTES = ["health", "start", "process"] as const;

/**
 * Serves the same /api/convert/* and /api/ilove/* serverless functions that
 * Vercel runs, so local `npm run dev` and production share one code path.
 */
export function convertApiPlugin(mode: string): Plugin {
  return {
    name: "pdf-palette-convert-api",
    configureServer(server) {
      // Let CLOUDCONVERT_API_KEY / ILOVEPDF_* live in .env for local development.
      const env = loadEnv(mode, process.cwd(), "");
      for (const key of Object.keys(env)) {
        if (!key.startsWith("VITE_") && process.env[key] === undefined) {
          process.env[key] = env[key];
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const convert = /^\/api\/convert\/([a-z]+)\/?$/.exec(url);
        const ilove = /^\/api\/ilove\/([a-z]+)\/?$/.exec(url);
        const kind = convert
          ? { dir: "api/convert", name: convert[1], routes: CONVERT_ROUTES }
          : ilove
            ? { dir: "api/ilove", name: ilove[1], routes: ILOVE_ROUTES }
            : null;
        if (!kind || !kind.routes.includes(kind.name as never)) {
          next();
          return;
        }
        try {
          const file = path.resolve(process.cwd(), kind.dir, `${kind.name}.js`);
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
