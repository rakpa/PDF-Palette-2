import { apiKey } from "../_lib/cloudconvert.js";
import { sendJson } from "../_lib/http.js";

export default function handler(req, res) {
  const cloudconvert = Boolean(apiKey());
  sendJson(res, cloudconvert ? 200 : 503, {
    status: cloudconvert ? "ok" : "degraded",
    checks: { cloudconvert },
    engine: cloudconvert ? "cloudconvert" : "unconfigured",
    conversions: cloudconvert ? ["word-to-pdf", "pdf-to-word"] : [],
    timestamp: new Date().toISOString(),
  });
}
