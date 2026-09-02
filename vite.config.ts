import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { ghostscriptAssetsPlugin } from "./vite.ghostscript";
import { pdfjsWorkerPlugin } from "./vite.pdfjs";
import { crossOriginIsolationPlugin } from "./vite.crossOriginIsolation";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
    proxy: {
      "/api/conversion/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: () => "/health",
      },
      "/api/word-to-pdf": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/word-to-pdf/, "/v1/word-to-pdf"),
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
      "/api/pdf-to-word": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/pdf-to-word/, "/v1/pdf-to-word"),
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
      "/api/unlock-pdf": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/unlock-pdf/, "/v1/unlock-pdf"),
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
      "/api/protect-pdf": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/protect-pdf/, "/v1/protect-pdf"),
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
      "/api/html-to-pdf": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/html-to-pdf/, "/v1/html-to-pdf"),
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
  plugins: [
    crossOriginIsolationPlugin(),
    ghostscriptAssetsPlugin(),
    pdfjsWorkerPlugin(),
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  },
}));
