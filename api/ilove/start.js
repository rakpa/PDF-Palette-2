import { startPdfToWord } from "../_lib/ilovepdf.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const filename = String(body.filename || "document.pdf");
    const started = await startPdfToWord();
    const base = filename.replace(/\.pdf$/i, "") || "document";
    sendJson(res, 200, {
      engine: "ilovepdf",
      token: started.token,
      server: started.server,
      task: started.task,
      tool: started.tool,
      uploadUrl: `https://${started.server}/v1/upload`,
      filename: `${base}.docx`,
    });
  } catch (error) {
    sendError(res, error);
  }
}
