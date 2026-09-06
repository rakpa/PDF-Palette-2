import { startPdfToWord, startWordToPdf } from "../_lib/ilovepdf.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const kind = body.kind === "word-to-pdf" ? "word-to-pdf" : "pdf-to-word";
    const filename = String(body.filename || (kind === "word-to-pdf" ? "document.docx" : "document.pdf"));
    const started = kind === "word-to-pdf" ? await startWordToPdf() : await startPdfToWord();
    const base =
      kind === "word-to-pdf"
        ? filename.replace(/\.docx?$/i, "") || "document"
        : filename.replace(/\.pdf$/i, "") || "document";
    sendJson(res, 200, {
      engine: "ilovepdf",
      token: started.token,
      server: started.server,
      task: started.task,
      tool: started.tool,
      uploadUrl: `https://${started.server}/v1/upload`,
      filename: kind === "word-to-pdf" ? `${base}.pdf` : `${base}.docx`,
    });
  } catch (error) {
    sendError(res, error);
  }
}
