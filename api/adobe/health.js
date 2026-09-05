import { credentials } from "../_lib/adobe.js";
import { sendJson } from "../_lib/http.js";

export default function handler(req, res) {
  const adobe = Boolean(credentials());
  sendJson(res, adobe ? 200 : 503, {
    status: adobe ? "ok" : "degraded",
    checks: { adobe },
    engine: adobe ? "adobe-pdf-services" : "unconfigured",
    conversions: adobe ? ["word-to-pdf", "pdf-to-word"] : [],
    timestamp: new Date().toISOString(),
  });
}
