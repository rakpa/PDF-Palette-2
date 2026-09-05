import { DOCX_TYPE, PDF_TYPE, assertJobId } from "../_lib/cloudconvert.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const jobId = assertJobId(body.jobId);
    const toWord = body.kind !== "word-to-pdf";
    const filename = String(body.filename || (toWord ? "document.pdf" : "document.docx"));

    sendJson(res, 200, {
      jobId,
      filename: toWord
        ? `${filename.replace(/\.pdf$/i, "") || "document"}.docx`
        : `${filename.replace(/\.docx?$/i, "") || "document"}.pdf`,
      contentType: toWord ? DOCX_TYPE : PDF_TYPE,
    });
  } catch (error) {
    sendError(res, error);
  }
}
