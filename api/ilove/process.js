import {
  assertSessionToken,
  looksLikePdf,
  looksLikePowerpoint,
  looksLikeWord,
  processTask,
} from "../_lib/ilovepdf.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

function kindOf(body) {
  if (body.kind === "word-to-pdf") return "word-to-pdf";
  if (body.kind === "html-to-pdf") return "html-to-pdf";
  if (body.kind === "pdf-to-ppt") return "pdf-to-ppt";
  return "pdf-to-word";
}

function convertToFor(kind) {
  if (kind === "pdf-to-word") return "docx";
  if (kind === "pdf-to-ppt") return "pptx";
  return undefined;
}

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const kind = kindOf(body);
    const token = assertSessionToken(body.token);
    const processed = await processTask({
      token,
      server: body.server,
      task: body.task,
      tool: body.tool,
      serverFilename: body.serverFilename,
      filename: body.filename || (kind === "html-to-pdf" ? "page.html" : undefined),
      convertTo: convertToFor(kind),
    });
    const ok =
      kind === "word-to-pdf" || kind === "html-to-pdf"
        ? looksLikePdf(processed)
        : kind === "pdf-to-ppt"
          ? looksLikePowerpoint(processed)
          : looksLikeWord(processed);
    if (!ok) {
      throw Object.assign(
        new Error(
          kind === "pdf-to-word"
            ? "Conversion finished but did not return a Word file."
            : kind === "pdf-to-ppt"
              ? "Conversion finished but did not return a PowerPoint file."
              : "Conversion finished but did not return a PDF."
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
