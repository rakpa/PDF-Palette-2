import {
  PDF_TYPE,
  createUploadJob,
  mediaTypeForWord,
  wordInputFormat,
} from "../_lib/cloudconvert.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const kind = body.kind === "word" ? "word" : "pdf";
    const filename = String(body.filename || "");
    const created =
      kind === "word"
        ? await createUploadJob(wordInputFormat(filename), "pdf")
        : await createUploadJob("pdf", "docx");
    const base =
      kind === "word"
        ? filename.replace(/\.docx?$/i, "") || "document"
        : filename.replace(/\.pdf$/i, "") || "document";
    sendJson(res, 200, {
      ...created,
      mediaType: kind === "word" ? mediaTypeForWord(filename) : PDF_TYPE,
      filename: kind === "word" ? `${base}.pdf` : `${base}.docx`,
    });
  } catch (error) {
    sendError(res, error);
  }
}
