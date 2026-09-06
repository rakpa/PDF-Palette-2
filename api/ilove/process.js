import { assertSessionToken, looksLikeWord, processTask } from "../_lib/ilovepdf.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const token = assertSessionToken(body.token);
    const processed = await processTask({
      token,
      server: body.server,
      task: body.task,
      tool: body.tool,
      serverFilename: body.serverFilename,
      filename: body.filename,
    });
    if (!looksLikeWord(processed)) {
      throw Object.assign(new Error("iLovePDF finished but did not return a Word file."), {
        statusCode: 502,
      });
    }
    sendJson(res, 200, {
      engine: "ilovepdf",
      downloadUrl: processed.downloadUrl,
      token,
      filename: processed.downloadFilename,
    });
  } catch (error) {
    sendError(res, error);
  }
}
