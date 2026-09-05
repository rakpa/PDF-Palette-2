import type { Connect, Plugin, ViteDevServer } from "vite";

/** COEP require-corp needs CORP on every same-origin response (workers, wasm, scripts). */
export function crossOriginIsolationPlugin(): Plugin {
  return {
    name: "cross-origin-isolation",
    enforce: "pre",
    configureServer(server) {
      prependMiddleware(server, (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url === "/adobe-bridge.html") {
          const writeHead = res.writeHead.bind(res);
          res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
            res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
            res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
            return writeHead(...args);
          }) as typeof res.writeHead;
          next();
          return;
        }
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        next();
      });
    },
  };
}

function corpHeaders(res: { setHeader: (k: string, v: string) => void }) {
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  // Dedicated workers (`new Worker(url)`) need COEP on the script itself;
  // CORP alone is enough for fetch/wasm, but Chrome blocks the worker entry.
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

/** Run before Vite's transform middleware so large WASM/LO scripts are served raw. */
export function prependMiddleware(
  server: ViteDevServer,
  handler: Connect.NextHandleFunction
): void {
  (server.middlewares as Connect.Server).stack.unshift({ route: "", handle: handler });
}

export { corpHeaders };
