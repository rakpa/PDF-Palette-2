import {
  assertSessionToken,
  looksLikePdf,
  looksLikeWord,
  processTask,
} from "../_lib/ilovepdf.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const kind = body.kind === "word-to-pdf" ? "word-to-pdf" : "pdf-to-word";
    const token = assertSessionToken(body.token);
    const processed = await processTask({
      token,
      server: body.server,
      task: body.task,
      tool: body.tool,
      serverFilename: body.serverFilename,
      filename: body.filename,
      convertTo: kind === "pdf-to-word" ? "docx" : undefined,
    });
    const ok = kind === "word-to-pdf" ? looksLikePdf(processed) : looksLikeWord(processed);
    if (!ok) {
      throw Object.assign(
        new Error(
          kind === "word-to-pdf"
            ? "iLovePDF finished but did not return a PDF."
            : "iLovePDF finished but did not return a Word file."
        ),
        { statusCode: 502 }
      );
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
