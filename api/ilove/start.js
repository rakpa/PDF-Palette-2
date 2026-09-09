import {
  assertPublicPageUrl,
  startHtmlToPdf,
  startPdfOcr,
  startPdfToPowerpoint,
  startPdfToWord,
  startWordToPdf,
  uploadPublicUrl,
} from "../_lib/ilovepdf.js";
import { guardMethod, readJson, sendError, sendJson } from "../_lib/http.js";

function kindOf(body) {
  if (body.kind === "word-to-pdf") return "word-to-pdf";
  if (body.kind === "html-to-pdf") return "html-to-pdf";
  if (body.kind === "pdf-to-ppt") return "pdf-to-ppt";
  if (body.kind === "ocr-pdf") return "ocr-pdf";
  return "pdf-to-word";
}

export default async function handler(req, res) {
  if (guardMethod(req, res, "POST")) return;
  try {
    const body = await readJson(req);
    const kind = kindOf(body);

    if (kind === "html-to-pdf") {
      const pageUrl = assertPublicPageUrl(body.url);
      const started = await startHtmlToPdf();
      const uploaded = await uploadPublicUrl({
        token: started.token,
        server: started.server,
        task: started.task,
        url: pageUrl,
      });
      let hostLabel = "page";
      try {
        hostLabel = new URL(pageUrl).hostname.replace(/^www\./, "") || "page";
      } catch {
        /* keep default */
      }
      const safeName = hostLabel.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "page";
      sendJson(res, 200, {
        engine: "ilovepdf",
        token: started.token,
        server: started.server,
        task: started.task,
        tool: started.tool,
        serverFilename: uploaded.serverFilename,
        filename: `${safeName}.pdf`,
      });
      return;
    }

    const filename = String(
      body.filename ||
        (kind === "word-to-pdf" ? "document.docx" : "document.pdf")
    );
    const started =
      kind === "word-to-pdf"
        ? await startWordToPdf()
        : kind === "pdf-to-ppt"
          ? await startPdfToPowerpoint()
          : kind === "ocr-pdf"
            ? await startPdfOcr()
            : await startPdfToWord();
    const base =
      kind === "word-to-pdf"
        ? filename.replace(/\.docx?$/i, "") || "document"
        : filename.replace(/\.pdf$/i, "") || "document";
    const outName =
      kind === "word-to-pdf" || kind === "ocr-pdf"
        ? `${base}.pdf`
        : kind === "pdf-to-ppt"
          ? `${base}.pptx`
          : `${base}.docx`;
    sendJson(res, 200, {
      engine: "ilovepdf",
      token: started.token,
      server: started.server,
      task: started.task,
      tool: started.tool,
      uploadUrl: `https://${started.server}/v1/upload`,
      filename: outName,
    });
  } catch (error) {
    sendError(res, error);
  }
}
