import { DOCX_TYPE, PDF_TYPE, startJob } from "../_lib/adobe.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const assetID = typeof body.assetID === "string" ? body.assetID.trim() : "";
    if (!assetID) {
      sendJson(res, 400, { error: "assetID is required." });
      return;
    }
    const toWord = body.kind !== "word-to-pdf";
    const filename = String(body.filename || (toWord ? "document.pdf" : "document.docx"));

    const statusUrl = toWord
      ? await startJob("exportpdf", { assetID, targetFormat: "docx" })
      : await startJob("createpdf", { assetID });

    sendJson(res, 200, {
      statusUrl,
      filename: toWord
        ? `${filename.replace(/\.pdf$/i, "") || "document"}.docx`
        : `${filename.replace(/\.docx?$/i, "") || "document"}.pdf`,
      contentType: toWord ? DOCX_TYPE : PDF_TYPE,
    });
  } catch (error) {
    sendError(res, error);
  }
}
