import { PDF_TYPE, createAsset, mediaTypeForWord } from "../_lib/adobe.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const kind = body.kind === "word" ? "word" : "pdf";
    const mediaType =
      kind === "word" ? mediaTypeForWord(String(body.filename || "")) : PDF_TYPE;
    sendJson(res, 200, await createAsset(mediaType));
  } catch (error) {
    sendError(res, error);
  }
}
