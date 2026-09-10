import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCw,
  ShieldCheck,
  Wand2,
} from "lucide-react";

import { warmupGhostscript } from "@/lib/ghostscript-compress";
import { getToolByRoute, ToolFeature } from "@/lib/tools";
import {
  CompressionLevel,
  ProcessingResult,
  addPageNumbersToPDF,
  addWatermark,
  compressPDF,
  downloadResult,
  excelToPDF,
  flattenPDF,
  htmlToPDF,
  imagesToPDF,
  mergePDFs,
  pdfToExcel,
  pdfToImageFiles,
  pdfToPpt,
  pdfToWord,
  pdfToWordIlove,
  pdfToWordNew,
  pptToPDF,
  protectPDFWithPassword,
  rotatePDF,
  txtToPDF,
  unlockPDF,
  wordToPDF,
  wordToPdfIlove,
  ocrPDF,
  repairPDF,
  extractTextFromPDF,
  extractImagesFromPDF,
  editPdfMetadata,
  addHeadersFootersToPDF,
  markdownToPDF,
  csvToPDF,
  autoRedactPiiPDF,
} from "@/lib/pdf-utils";
import ToolPageLayout from "@/components/ToolPageLayout";
import PdfEditor from "@/components/pdf-editor/PdfEditor";
import PageOrganizer from "@/components/pdf-pages/PageOrganizer";
import PdfSplitter from "@/components/pdf-pages/PdfSplitter";
import PdfCropper from "@/components/pdf-pages/PdfCropper";
import PdfFormFiller from "@/components/pdf-pages/PdfFormFiller";
import PdfRedactor from "@/components/pdf-pages/PdfRedactor";
import PdfComparer from "@/components/pdf-pages/PdfComparer";
import PdfChatPanel from "@/components/PdfChatPanel";
import { DEFAULT_PAGE_NUMBERS } from "@/lib/pdf-pages/page-numbers";
import type { NumberPosition, PageNumberOptions } from "@/lib/pdf-pages/page-numbers";
import type { PdfToImageOptions } from "@/lib/pdf-to-image";
import {
  DEFAULT_HEADERS_FOOTERS,
  type HeaderFooterOptions,
} from "@/lib/headers-footers";
import type { PdfMetadataFields } from "@/lib/edit-metadata";
import { readPdfMetadata } from "@/lib/edit-metadata";
import FileUploader, { UploadedFile } from "@/components/FileUploader";
import ProgressBar from "@/components/ProgressBar";
import NotFound from "./NotFound";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Per-feature upload constraints for the one-shot tools. The editor features
 * run their own interactive flow and never reach this table.
 */
/** Tools that own their whole surface rather than the upload-and-convert flow. */
type InteractiveFeature =
  | "edit-pdf"
  | "sign-pdf"
  | "organize-pages"
  | "remove-pages"
  | "extract-pages"
  | "crop-pdf"
  | "fill-forms"
  | "redact"
  | "compare"
  | "split"
  | "chat-with-pdf";

const featureConfig: Record<
  Exclude<ToolFeature, InteractiveFeature>,
  {
    accept: Record<string, string[]>;
    maxFiles: number;
    minFiles: number;
    cta: string;
    hint: string;
  }
> = {
  merge: {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 20,
    minFiles: 2,
    cta: "Merge PDFs",
    hint: "Add two or more PDFs. They’ll be combined in the order shown — use the arrows to rearrange them.",
  },
  rotate: {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Rotate PDF",
    hint: "Pick how far to turn every page.",
  },
  compress: {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Compress PDF",
    hint: "",
  },
  watermark: {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Add Watermark",
    hint: "Stamp custom text diagonally across every page.",
  },
  "jpg-to-pdf": {
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] },
    maxFiles: 30,
    minFiles: 1,
    cta: "Create PDF",
    hint: "Add JPG or PNG images — one image per page, in order.",
  },
  "word-to-pdf": {
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/msword": [".doc"],
    },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload a .doc or .docx file. CloudConvert converts it to a PDF that keeps fonts, tables, images and page layout.",
  },
  "word-to-pdf-ilove": {
    accept: {
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/msword": [".doc"],
    },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload a .doc or .docx file. It is converted to a PDF that keeps fonts, tables, images and page layout.",
  },
  "pdf-to-word": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to Word",
    hint: "Upload a PDF. CloudConvert converts it to an editable Word (.docx) file, keeping fonts, tables, images and page layout.",
  },
  "pdf-to-word-new": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Rebuild as Word",
    hint: "Upload a PDF. Every page is rebuilt in Word at its own size, with the text, tables, pictures, rules and colours kept where the PDF put them. Nothing is uploaded.",
  },
  "pdf-to-word-ilove": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to Word",
    hint: "Upload a PDF. It is converted to an editable Word (.docx) file.",
  },
  "unlock-pdf": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Unlock PDF",
    hint: "Enter the password used to open the PDF, then download an unlocked copy.",
  },
  "protect-pdf": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Protect PDF",
    hint: "Set a password required to open the PDF.",
  },
  "excel-to-pdf": {
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"],
    },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload an .xlsx workbook. Every sheet becomes pages, with its own number formats, colours, borders and merged cells.",
  },
  "ppt-to-pdf": {
    accept: {
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
    },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload a .pptx deck. Each slide becomes a page at its own size, with its text, pictures, tables and theme colours.",
  },
  "pdf-to-excel": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to Excel",
    hint: "Upload a PDF. It is converted to an editable Excel (.xlsx) workbook via the same conversion service as PDF to Word.",
  },
  "pdf-to-ppt": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PowerPoint",
    hint: "Upload a PDF. It is converted to an editable PowerPoint (.pptx) file that keeps the original look.",
  },
  "page-numbers": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Add page numbers",
    hint: "Choose where the number sits and how it reads.",
  },
  "pdf-to-jpg": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to images",
    hint: "Every page becomes a JPG or PNG. More than one page comes back as a ZIP.",
  },
  "html-to-pdf": {
    accept: { "text/html": [".html", ".htm"] },
    maxFiles: 1,
    minFiles: 0,
    cta: "Convert to PDF",
    hint: "Provide an HTML file or a URL.",
  },
  "flatten-pdf": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Flatten PDF",
    hint: "Make form fields and pages uneditable. Text becomes part of the page image.",
  },
  "txt-to-pdf": {
    accept: { "text/plain": [".txt", ".text"], "text/markdown": [".md"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload a .txt file. It is laid out as a simple multi-page PDF.",
  },
  "repair-pdf": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Repair PDF",
    hint: "Rebuild the PDF page-by-page. Helps with many damaged or incomplete files.",
  },
  "extract-text": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Extract text",
    hint: "Pull all selectable text into a .txt download. Use OCR first for scanned pages.",
  },
  "extract-images": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Extract images",
    hint: "Save embedded images (or page renders) as PNG. Multiple images download as a ZIP.",
  },
  "edit-metadata": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Save metadata",
    hint: "Update title, author, subject and keywords stored in the PDF.",
  },
  "headers-footers": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Add headers & footers",
    hint: "Use {n} for page number, {N} for total pages, {date} for today’s date.",
  },
  "markdown-to-pdf": {
    accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload a Markdown (.md) file. Headings, lists and code blocks are laid out as PDF.",
  },
  "csv-to-pdf": {
    accept: { "text/csv": [".csv"], "text/plain": [".csv", ".txt"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Convert to PDF",
    hint: "Upload a CSV. The first row is treated as a header on every page.",
  },
  "auto-redact-pii": {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Auto-redact PII",
    hint: "Finds names, emails, phones, addresses and labeled contact fields. Scanned/image PDFs need OCR PDF first so the text is selectable.",
  },
  ocr: {
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    minFiles: 1,
    cta: "Apply OCR",
    hint: "Upload a scanned PDF. Recognition runs via the same conversion service as PDF to Word — download a searchable copy when it finishes.",
  },
};

/**
 * Everything runs in the tab, so a large file can exhaust the browser's own
 * memory well before it hits the upload size cap. Name that case instead of
 * surfacing whatever cryptic message the failed allocation threw.
 */
function describeProcessingError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/out of memory|allocation failed|invalid array length|invalid typed array/i.test(message)) {
    return "This file is too large for your browser to process in one go. Try splitting it into smaller files first, or use a device with more memory.";
  }
  return err instanceof Error ? message : "Something went wrong.";
}

const ToolPage = () => {
  const { toolRoute } = useParams();
  const tool = getToolByRoute(`/${toolRoute}`);

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ProcessingResult | null>(null);

  // Tool-specific options
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [opacity, setOpacity] = useState(0.3);
  const [compressionLevel, setCompressionLevel] =
    useState<CompressionLevel>("recommended");
  const [convertStatus, setConvertStatus] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [htmlUrl, setHtmlUrl] = useState("");
  const [pageNumbers, setPageNumbers] = useState<PageNumberOptions>(DEFAULT_PAGE_NUMBERS);
  const [imageOptions, setImageOptions] = useState<PdfToImageOptions>({
    format: "jpg",
    dpi: 150,
    quality: 0.92,
  });
  const [metadata, setMetadata] = useState<PdfMetadataFields>({
    title: "",
    author: "",
    subject: "",
    keywords: "",
    creator: "",
    producer: "",
  });
  const [headersFooters, setHeadersFooters] =
    useState<HeaderFooterOptions>(DEFAULT_HEADERS_FOOTERS);

  const config = useMemo(
    () =>
      tool?.feature && tool.feature in featureConfig
        ? featureConfig[tool.feature as keyof typeof featureConfig]
        : undefined,
    [tool]
  );

  // Preload Ghostscript WASM while the user picks a file — saves 10–15s on first compress.
  useEffect(() => {
    if (tool?.feature !== "compress") return;
    warmupGhostscript().catch(() => {
      // Warmup is best-effort; compress will retry loading the engine.
    });
  }, [tool?.feature]);

  if (!tool) return <NotFound />;

  // Editing and signing are interactive: the editor owns its own upload step,
  // canvas and download, so it replaces the standard process-and-download flow.
  if (tool.feature === "edit-pdf" || tool.feature === "sign-pdf") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfEditor mode={tool.feature === "sign-pdf" ? "sign" : "edit"} />
      </ToolPageLayout>
    );
  }

  // Choosing pages, or a crop, is a thing you do by looking at the document —
  // so these tools show it rather than asking for typed page numbers.
  if (tool.feature === "split") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfSplitter />
      </ToolPageLayout>
    );
  }

  if (
    tool.feature === "organize-pages" ||
    tool.feature === "remove-pages" ||
    tool.feature === "extract-pages"
  ) {
    return (
      <ToolPageLayout tool={tool}>
        <PageOrganizer
          mode={
            tool.feature === "organize-pages"
              ? "organize"
              : tool.feature === "remove-pages"
                ? "remove"
                : "extract"
          }
        />
      </ToolPageLayout>
    );
  }

  if (tool.feature === "crop-pdf") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfCropper />
      </ToolPageLayout>
    );
  }

  if (tool.feature === "fill-forms") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfFormFiller />
      </ToolPageLayout>
    );
  }

  if (tool.feature === "redact") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfRedactor />
      </ToolPageLayout>
    );
  }

  if (tool.feature === "compare") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfComparer />
      </ToolPageLayout>
    );
  }

  if (tool.feature === "chat-with-pdf") {
    return (
      <ToolPageLayout tool={tool}>
        <PdfChatPanel />
      </ToolPageLayout>
    );
  }

  // An uploaded HTML file is laid out and captured by this tab. A URL cannot
  // be: same-origin policy stops a page reading another site's HTML, so that
  // path uses the same remote convert session as Word ↔ PDF.
  const fetchesUrl =
    tool.feature === "html-to-pdf" && files.length === 0 && htmlUrl.trim().length > 0;

  const canProcess =
    !!config &&
    (tool.feature === "html-to-pdf"
      ? files.length >= 1 || htmlUrl.trim().length > 0
      : files.length >= config.minFiles) &&
    !isProcessing;

  const reset = () => {
    setFiles([]);
    setResult(null);
    setProgress(0);
    setPassword("");
    setConfirmPassword("");
    setHtmlUrl("");
  };

  const handleProcess = async () => {
    if (!tool.feature || !config) return;
    setIsProcessing(true);
    setProgress(0);
    setConvertStatus("");
    setResult(null);

    const onProgress = (p: number) => setProgress(p);
    const inputFiles = files.map((f) => f.file);

    try {
      let res: ProcessingResult;

      switch (tool.feature) {
        case "merge":
          res = await mergePDFs(inputFiles, onProgress);
          break;
        case "rotate":
          res = await rotatePDF(inputFiles[0], rotation, undefined, onProgress);
          break;
        case "compress":
          res = await compressPDF(inputFiles[0], compressionLevel, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "watermark":
          res = await addWatermark(
            inputFiles[0],
            watermarkText || "CONFIDENTIAL",
            { opacity },
            onProgress
          );
          break;
        case "jpg-to-pdf":
          res = await imagesToPDF(inputFiles, onProgress);
          break;
        case "word-to-pdf":
          res = await wordToPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "word-to-pdf-ilove":
          res = await wordToPdfIlove(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "excel-to-pdf":
          res = await excelToPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "pdf-to-ppt":
          res = await pdfToPpt(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "pdf-to-excel":
          res = await pdfToExcel(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "ppt-to-pdf":
          res = await pptToPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "pdf-to-word":
          res = await pdfToWord(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "pdf-to-word-new":
          res = await pdfToWordNew(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "pdf-to-word-ilove":
          res = await pdfToWordIlove(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "unlock-pdf":
          res = await unlockPDF(inputFiles[0], password, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "protect-pdf":
          if (password.trim() !== confirmPassword.trim()) {
            res = { success: false, message: "Passwords do not match." };
            break;
          }
          res = await protectPDFWithPassword(inputFiles[0], password, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "page-numbers":
          res = await addPageNumbersToPDF(inputFiles[0], pageNumbers, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "pdf-to-jpg":
          res = await pdfToImageFiles(inputFiles[0], imageOptions, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "html-to-pdf":
          res = await htmlToPDF(
            { file: inputFiles[0], url: htmlUrl.trim() || undefined },
            (p, message) => {
              onProgress(p);
              if (message) setConvertStatus(message);
            }
          );
          break;
        case "ocr":
          res = await ocrPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "flatten-pdf":
          res = await flattenPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "txt-to-pdf":
          res = await txtToPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "repair-pdf":
          res = await repairPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "extract-text":
          res = await extractTextFromPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "extract-images":
          res = await extractImagesFromPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "edit-metadata":
          res = await editPdfMetadata(inputFiles[0], metadata, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "headers-footers":
          res = await addHeadersFootersToPDF(inputFiles[0], headersFooters, (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "markdown-to-pdf":
          res = await markdownToPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "csv-to-pdf":
          res = await csvToPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        case "auto-redact-pii":
          res = await autoRedactPiiPDF(inputFiles[0], (p, message) => {
            onProgress(p);
            if (message) setConvertStatus(message);
          });
          break;
        default:
          res = { success: false, message: "This tool isn’t available yet." };
      }

      setResult(res);
      if (res.success) {
        toast.success(res.message);
        const waitForDownload =
          tool.feature === "pdf-to-word-ilove" ||
          tool.feature === "word-to-pdf-ilove" ||
          tool.feature === "pdf-to-ppt" ||
          tool.feature === "pdf-to-excel" ||
          tool.feature === "ocr" ||
          fetchesUrl;
        if (res.blob && !waitForDownload) downloadResult(res);
      } else {
        toast.error(res.message);
      }
    } catch (err) {
      const message = describeProcessingError(err);
      setResult({ success: false, message });
      toast.error(message);
    } finally {
      setProgress(100);
      setConvertStatus("");
      setIsProcessing(false);
    }
  };

  return (
    <ToolPageLayout tool={tool}>
      <div className="mx-auto max-w-2xl">
        {!config ? (
          <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center text-muted-foreground">
            This tool isn’t available yet.
          </div>
        ) : (
          <div className="space-y-4">
            <FileUploader
              compact
              accept={config.accept}
              maxFiles={config.maxFiles}
              files={files}
              onFilesChange={(f) => {
                setFiles(f);
                setResult(null);
              }}
              labels={
                tool.feature === "html-to-pdf"
                  ? { dropzone: "Drag & drop an HTML file here", button: "Select HTML file" }
                  : undefined
              }
            />

            {config.hint ? (
              <p className="text-center text-sm text-muted-foreground">{config.hint}</p>
            ) : null}

            {/* Tool-specific options */}
            {files.length > 0 &&
              (tool.feature === "rotate" ||
                tool.feature === "watermark" ||
                tool.feature === "compress") && (
              <div className="rounded-xl border border-border bg-card p-4">
                {tool.feature === "rotate" && (
                  <RotateOptions value={rotation} onChange={setRotation} />
                )}
                {tool.feature === "watermark" && (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="wm">Watermark text</Label>
                      <Input
                        id="wm"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                        placeholder="CONFIDENTIAL"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <Label>Opacity</Label>
                        <span className="text-muted-foreground">
                          {Math.round(opacity * 100)}%
                        </span>
                      </div>
                      <Slider
                        value={[opacity]}
                        onValueChange={([v]) => setOpacity(v)}
                        min={0.05}
                        max={1}
                        step={0.05}
                      />
                    </div>
                  </div>
                )}
                {tool.feature === "compress" && (
                  <CompressOptions
                    value={compressionLevel}
                    onChange={setCompressionLevel}
                  />
                )}
              </div>
            )}

            {tool.feature === "page-numbers" && (
              <PageNumberOptionsPanel value={pageNumbers} onChange={setPageNumbers} />
            )}

            {tool.feature === "pdf-to-jpg" && (
              <ImageOptionsPanel value={imageOptions} onChange={setImageOptions} />
            )}

            {tool.feature === "edit-metadata" && (
              <MetadataOptionsPanel
                value={metadata}
                onChange={setMetadata}
                file={files[0]?.file}
              />
            )}

            {tool.feature === "headers-footers" && (
              <HeadersFootersOptionsPanel
                value={headersFooters}
                onChange={setHeadersFooters}
              />
            )}

            {(tool.feature === "unlock-pdf" ||
              tool.feature === "protect-pdf" ||
              tool.feature === "html-to-pdf") && (
              <div className="rounded-xl border border-border bg-card p-4">
                {tool.feature === "html-to-pdf" ? (
                  <div className="space-y-2">
                    <Label htmlFor="html-url">URL (optional)</Label>
                    <Input
                      id="html-url"
                      placeholder="https://example.com/page"
                      value={htmlUrl}
                      onChange={(e) => setHtmlUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Upload an HTML file to convert it here in your browser, or paste a
                      page URL to convert it remotely. If you provide both, the file wins.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="pw">
                        {tool.feature === "unlock-pdf" ? "Password" : "New password"}
                      </Label>
                      <Input
                        id="pw"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={tool.feature === "unlock-pdf" ? "Enter PDF password" : "At least 4 characters"}
                      />
                    </div>
                    {tool.feature === "protect-pdf" && (
                      <div className="space-y-2">
                        <Label htmlFor="pw2">Confirm password</Label>
                        <Input
                          id="pw2"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Progress */}
            {isProcessing && (
              <ProgressBar
                progress={progress}
                label={
                  tool.feature === "pdf-to-word-ilove" ||
                  tool.feature === "word-to-pdf-ilove" ||
                  tool.feature === "pdf-to-ppt" ||
                  tool.feature === "pdf-to-excel" ||
                  tool.feature === "ocr" ||
                  fetchesUrl
                    ? convertStatus || (tool.feature === "ocr" ? "Recognising…" : "Converting…")
                    : tool.feature === "word-to-pdf" ||
                        tool.feature === "pdf-to-word" ||
                        tool.feature === "pdf-to-word-new"
                      ? convertStatus || "Converting…"
                      : tool.feature === "compress"
                        ? convertStatus || "Compressing…"
                        : "Processing…"
                }
                indeterminate={
                  (tool.feature === "word-to-pdf" ||
                    tool.feature === "word-to-pdf-ilove" ||
                    tool.feature === "pdf-to-word" ||
                    tool.feature === "pdf-to-word-ilove" ||
                    tool.feature === "pdf-to-ppt" ||
                    tool.feature === "pdf-to-excel" ||
                    tool.feature === "html-to-pdf" ||
                    tool.feature === "ocr") &&
                  progress === 0 &&
                  !convertStatus
                }
              />
            )}

            {/* Result banner */}
            {result?.success && !isProcessing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 rounded-xl border border-tool-green/30 bg-tool-green/10 p-4"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-tool-green" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">Done!</p>
                  <p className="text-sm text-muted-foreground">{result.message}</p>
                </div>
                {result.blob && (
                  <Button
                    size={
                      tool.feature === "pdf-to-word-ilove" ||
                      tool.feature === "word-to-pdf-ilove" ||
                      tool.feature === "pdf-to-ppt" ||
                      tool.feature === "pdf-to-excel" ||
                      tool.feature === "ocr" ||
                      fetchesUrl
                        ? "default"
                        : "sm"
                    }
                    variant={
                      tool.feature === "pdf-to-word-ilove" ||
                      tool.feature === "word-to-pdf-ilove" ||
                      tool.feature === "pdf-to-ppt" ||
                      tool.feature === "pdf-to-excel" ||
                      tool.feature === "ocr" ||
                      fetchesUrl
                        ? "default"
                        : "outline"
                    }
                    onClick={() => downloadResult(result)}
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    Download
                  </Button>
                )}
              </motion.div>
            )}

            {/* Failures stay on screen; a toast alone is gone before the
                user has read why the file could not be converted. */}
            {result && !result.success && !isProcessing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="font-medium text-foreground">Couldn’t convert this file</p>
                  <p className="text-sm text-muted-foreground">{result.message}</p>
                </div>
              </motion.div>
            )}

            {/* Action */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <Button
                size="lg"
                className="min-w-[220px] gap-2 text-base font-semibold md:text-lg"
                disabled={!canProcess}
                onClick={handleProcess}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    {config.cta}
                  </>
                )}
              </Button>
              {(files.length > 0 || result) && !isProcessing && (
                <Button size="lg" variant="ghost" onClick={reset}>
                  Start over
                </Button>
              )}
            </div>

            <PrivacyNote remote={
              tool.feature === "pdf-to-word-ilove" ||
              tool.feature === "word-to-pdf-ilove" ||
              tool.feature === "pdf-to-ppt" ||
              tool.feature === "pdf-to-excel" ||
              tool.feature === "ocr" ||
              fetchesUrl
            } />
          </div>
        )}
      </div>
    </ToolPageLayout>
  );
};

const RotateOptions = ({
  value,
  onChange,
}: {
  value: 90 | 180 | 270;
  onChange: (v: 90 | 180 | 270) => void;
}) => (
  <div className="space-y-3">
    <Label>Rotation</Label>
    <div className="flex flex-wrap gap-2">
      {([90, 180, 270] as const).map((deg) => (
        <button
          key={deg}
          onClick={() => onChange(deg)}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all",
            value === deg
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
          )}
        >
          <RotateCw className="h-4 w-4" style={{ transform: `rotate(${deg}deg)` }} />
          {deg}°
        </button>
      ))}
    </div>
  </div>
);

const CompressOptions = ({
  value,
  onChange,
}: {
  value: CompressionLevel;
  onChange: (v: CompressionLevel) => void;
}) => {
  const options: { id: CompressionLevel; label: string; desc: string }[] = [
    { id: "low", label: "Low", desc: "300 DPI — near-lossless" },
    { id: "recommended", label: "Recommended", desc: "200 DPI — best balance" },
    { id: "extreme", label: "Extreme", desc: "100 DPI — smallest file" },
  ];
  return (
    <div className="space-y-3">
      <Label>Compression level</Label>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-xl border px-3 py-3 text-center transition-all",
              value === o.id
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/40"
            )}
          >
            <div
              className={cn(
                "text-sm font-medium",
                value === o.id ? "text-primary" : "text-foreground"
              )}
            >
              {o.label}
            </div>
            <div className="text-xs text-muted-foreground">{o.desc}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Recommended keeps text sharp and colours unchanged while shrinking large
        images. Low leaves image quality untouched; Extreme targets the smallest
        file. Scanned text is kept at 300 DPI at every level.
      </p>
    </div>
  );
};

const POSITIONS: Array<{ id: NumberPosition; label: string }> = [
  { id: "top-left", label: "Top left" },
  { id: "top-center", label: "Top centre" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-center", label: "Bottom centre" },
  { id: "bottom-right", label: "Bottom right" },
];

const FORMATS: Array<{ id: string; label: string }> = [
  { id: "{n}", label: "1" },
  { id: "{n} / {N}", label: "1 / 10" },
  { id: "Page {n} of {N}", label: "Page 1 of 10" },
  { id: "- {n} -", label: "- 1 -" },
];

const PageNumberOptionsPanel = ({
  value,
  onChange,
}: {
  value: PageNumberOptions;
  onChange: (next: PageNumberOptions) => void;
}) => {
  const set = <K extends keyof PageNumberOptions>(key: K, next: PageNumberOptions[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="space-y-2">
        <Label>Position</Label>
        <div className="grid grid-cols-3 gap-2">
          {POSITIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => set("position", option.id)}
              className={cn(
                "rounded-lg border px-2 py-2 text-xs transition",
                value.position === option.id
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Format</Label>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => set("format", option.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs transition",
                value.format === option.id
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="pn-start" className="text-xs">
            Start at
          </Label>
          <Input
            id="pn-start"
            type="number"
            min={0}
            value={value.startAt}
            onChange={(e) => set("startAt", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pn-from" className="text-xs">
            First page
          </Label>
          <Input
            id="pn-from"
            type="number"
            min={1}
            value={value.fromPage}
            onChange={(e) => set("fromPage", Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pn-to" className="text-xs">
            Last page
          </Label>
          <Input
            id="pn-to"
            type="number"
            min={0}
            placeholder="End"
            value={value.toPage || ""}
            onChange={(e) => set("toPage", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pn-size" className="text-xs">
            Text size
          </Label>
          <Input
            id="pn-size"
            type="number"
            min={4}
            max={72}
            value={value.fontSize}
            onChange={(e) => set("fontSize", Number(e.target.value) || 11)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["sans", "serif", "mono"] as const).map((face) => (
          <button
            key={face}
            type="button"
            onClick={() => set("face", face)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs capitalize transition",
              value.face === face
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {face}
          </button>
        ))}
      </div>
    </div>
  );
};

const ImageOptionsPanel = ({
  value,
  onChange,
}: {
  value: PdfToImageOptions;
  onChange: (next: PdfToImageOptions) => void;
}) => (
  <div className="space-y-4 rounded-xl border border-border bg-card p-4">
    <div className="space-y-2">
      <Label>Format</Label>
      <div className="flex gap-2">
        {(["jpg", "png"] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => onChange({ ...value, format })}
            className={cn(
              "rounded-lg border px-4 py-2 text-sm uppercase transition",
              value.format === format
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {format}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.format === "png"
          ? "Lossless, and keeps crisp edges — larger files."
          : "Smaller files, ideal for photos and scans."}
      </p>
    </div>

    <div className="space-y-2">
      <Label>Quality</Label>
      <div className="flex flex-wrap gap-2">
        {[
          { dpi: 96, label: "Screen · 96 dpi" },
          { dpi: 150, label: "Good · 150 dpi" },
          { dpi: 300, label: "Print · 300 dpi" },
        ].map((option) => (
          <button
            key={option.dpi}
            type="button"
            onClick={() => onChange({ ...value, dpi: option.dpi })}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs transition",
              value.dpi === option.dpi
                ? "border-primary bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  </div>
);

const MetadataOptionsPanel = ({
  value,
  onChange,
  file,
}: {
  value: PdfMetadataFields;
  onChange: (next: PdfMetadataFields) => void;
  file?: File;
}) => {
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    readPdfMetadata(file)
      .then((fields) => {
        if (!cancelled) onChange(fields);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when file identity changes
  }, [file]);

  const set = (key: keyof PdfMetadataFields, v: string) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {(
        [
          ["title", "Title"],
          ["author", "Author"],
          ["subject", "Subject"],
          ["keywords", "Keywords (comma-separated)"],
          ["creator", "Creator"],
          ["producer", "Producer"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="space-y-1.5">
          <Label htmlFor={`meta-${key}`}>{label}</Label>
          <Input
            id={`meta-${key}`}
            value={value[key]}
            onChange={(e) => set(key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
};

const HeadersFootersOptionsPanel = ({
  value,
  onChange,
}: {
  value: HeaderFooterOptions;
  onChange: (next: HeaderFooterOptions) => void;
}) => {
  const set = <K extends keyof HeaderFooterOptions>(key: K, v: HeaderFooterOptions[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">
        Tokens: {"{n}"} page number · {"{N}"} total pages · {"{date}"} today
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["headerLeft", "Header left"],
            ["headerCenter", "Header center"],
            ["headerRight", "Header right"],
            ["footerLeft", "Footer left"],
            ["footerCenter", "Footer center"],
            ["footerRight", "Footer right"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              value={value[key]}
              onChange={(e) => set(key, e.target.value)}
              placeholder={key.includes("Center") ? "Page {n} of {N}" : ""}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="hf-size">Font size</Label>
          <Input
            id="hf-size"
            type="number"
            min={6}
            max={24}
            value={value.fontSize}
            onChange={(e) => set("fontSize", Number(e.target.value) || 10)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hf-margin">Margin</Label>
          <Input
            id="hf-margin"
            type="number"
            min={12}
            max={72}
            value={value.margin}
            onChange={(e) => set("margin", Number(e.target.value) || 36)}
          />
        </div>
      </div>
    </div>
  );
};

const PrivacyNote = ({ remote = false }: { remote?: boolean }) => (
  <div className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
    <ShieldCheck className="h-4 w-4 text-tool-green" />
    {remote
      ? "Sent for conversion only — PDF Palette does not keep a copy."
      : "Processed in your browser — your file never leaves this device."}
  </div>
);

export default ToolPage;
