import type { IncomingMessage, ServerResponse } from "node:http";
import { AdobeConversionError } from "./lib/adobe-pdf-services.js";
import { ADOBE_MEDIA } from "./lib/adobe-pdf-services.js";
import {
  adobeConfigured,
  beginAdobeUpload,
  finishAdobeJob,
  mediaTypeForWord,
} from "./lib/adobe-convert.js";
import { loadConfig } from "./config.js";

const appConfig = loadConfig();
const log = {
  info: (obj: unknown, msg?: string) => console.log(msg ?? "", obj),
  error: (obj: unknown, msg?: string) => console.error(msg ?? "", obj),
  child: () => log,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

function routePath(pathname: string): string {
  return (
    pathname.replace(/^\/_\/word-to-pdf/, "").replace(/\/$/, "") || "/"
  );
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorStatus(error: unknown): number {
  if (error instanceof AdobeConversionError) return error.statusCode;
  return 500;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = routePath(url.pathname);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (method === "GET" && (path === "/health" || path === "/")) {
    const adobe = adobeConfigured(appConfig);
    return json(adobe ? 200 : 503, {
      status: adobe ? "ok" : "degraded",
      checks: { adobe },
      engine: adobe ? "adobe-pdf-services" : "unconfigured",
      conversions: adobe ? ["word-to-pdf", "pdf-to-word"] : [],
      timestamp: new Date().toISOString(),
    });
  }

  if (method === "POST" && path === "/v1/pdf-to-word/asset") {
    const created = await beginAdobeUpload(appConfig, ADOBE_MEDIA.pdf);
    return json(200, created);
  }

  if (method === "POST" && path === "/v1/word-to-pdf/asset") {
    const body = await readJson(request);
    const filename = typeof body.filename === "string" ? body.filename : "document.docx";
    const created = await beginAdobeUpload(appConfig, mediaTypeForWord(filename));
    return json(200, created);
  }

  if (method === "POST" && (path === "/v1/pdf-to-word/jobs" || path === "/v1/word-to-pdf/jobs")) {
    const body = await readJson(request);
    const assetID = typeof body.assetID === "string" ? body.assetID.trim() : "";
    const filename =
      typeof body.filename === "string"
        ? body.filename
        : path.includes("pdf-to-word")
          ? "document.pdf"
          : "document.docx";
    if (!assetID) return json(400, { error: "assetID is required." });
    const result = await finishAdobeJob(appConfig, log as never, {
      assetID,
      filename,
      operation: path.includes("pdf-to-word") ? "exportpdf" : "createpdf",
    });
    return json(200, result);
  }

  return json(404, { error: "Not found", path });
}

async function incomingToRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || "localhost";
  const url = `https://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(url, { method: req.method, headers });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: Buffer.concat(chunks),
  });
}

export default async function handler(
  req: Request | IncomingMessage,
  res?: ServerResponse
): Promise<Response | void> {
  try {
    const request = typeof (req as Request).headers?.get === "function"
      ? (req as Request)
      : await incomingToRequest(req as IncomingMessage);
    const response = await handle(request);

    if (res && typeof res.writeHead === "function") {
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversion service failed";
    const status = errorStatus(error);
    if (res && typeof res.writeHead === "function") {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: message }));
      return;
    }
    return json(status, { error: message });
  }
}
