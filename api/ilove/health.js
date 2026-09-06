import { configured, publicKey } from "../_lib/ilovepdf.js";
import { sendJson } from "../_lib/http.js";

export default function handler(req, res) {
  const ilovepdf = configured();
  sendJson(res, ilovepdf ? 200 : 503, {
    status: ilovepdf ? "ok" : "degraded",
    checks: { ilovepdf },
    engine: ilovepdf ? "ilovepdf" : "unconfigured",
    hasPublicKey: Boolean(publicKey()),
    timestamp: new Date().toISOString(),
  });
}
