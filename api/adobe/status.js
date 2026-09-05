import { assertAdobeStatusUrl, pollJob } from "../_lib/adobe.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const statusUrl = assertAdobeStatusUrl(body.statusUrl);
    sendJson(res, 200, await pollJob(statusUrl));
  } catch (error) {
    sendError(res, error);
  }
}
