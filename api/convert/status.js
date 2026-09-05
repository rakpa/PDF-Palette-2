import { assertJobId, pollJob } from "../_lib/cloudconvert.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    sendJson(res, 200, await pollJob(assertJobId(body.jobId)));
  } catch (error) {
    sendError(res, error);
  }
}
