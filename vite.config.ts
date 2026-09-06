import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { ghostscriptAssetsPlugin } from "./vite.ghostscript";
import { pdfjsWorkerPlugin } from "./vite.pdfjs";
import { tesseractAssetsPlugin } from "./vite.tesseract";
import { crossOriginIsolationPlugin } from "./vite.crossOriginIsolation";
import { convertApiPlugin } from "./vite.convertApi";
import { viteStaticCopy } from "vite-plugin-static-copy";

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
    convertApiPlugin(mode),
    ghostscriptAssetsPlugin(),
    pdfjsWorkerPlugin(),
    tesseractAssetsPlugin(),
    // Apryse WebViewer ships its wasm, UI html and css as static files that must
    // sit next to the app, not go through the bundler. `public/*` (not `**/*`)
    // keeps the `core/` and `ui/` folders intact, which is the layout the
    // viewer's `path` option expects.
    //
    // Only the modules the viewer actually needs are listed. The editor and
    // legacy ones (officeEditor, spreadsheetEditor, contentEdit, legacyOffice)
    // are left out: this viewer is read-only and only ever opens PDF and DOCX,
    // and copying everything put 174 MB into every deploy of the whole site.
    // Add an entry here if a tool ever needs to edit in the viewer.
    viteStaticCopy({
      targets: [
        { src: "node_modules/@pdftron/webviewer/public/ui", dest: "lib/webviewer" },
        {
          src: "node_modules/@pdftron/webviewer/public/core/{assets,external,office,pdf}",
          dest: "lib/webviewer/core",
        },
        {
          src: "node_modules/@pdftron/webviewer/public/core/*.js",
          dest: "lib/webviewer/core",
        },
      ],
    }),
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
