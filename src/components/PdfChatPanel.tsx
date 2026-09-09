import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import FileUploader, { type UploadedFile } from "@/components/FileUploader";
import { extractPdfTextString } from "@/lib/extract-text";
import {
  answerFromPdfText,
  buildSummaryFromText,
  summarizePdfLocal,
} from "@/lib/summarize-pdf";
import { downloadResult } from "@/lib/pdf-utils";
import { toast } from "sonner";

/**
 * Local summarize + ask-about-PDF. No cloud AI — keyword / extractive only.
 */
const PdfChatPanel = () => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const pdfFile = files[0]?.file;

  const load = async () => {
    if (!pdfFile) return;
    setBusy(true);
    setAnswer("");
    setSummary("");
    setText("");
    try {
      // Extract once — summarize from the same text (avoids double work / double failure).
      const extracted = await extractPdfTextString(pdfFile, (_p, m) => setStatus(m || ""));
      setText(extracted);
      setStatus("Building summary…");
      const built = buildSummaryFromText(pdfFile.name, extracted);
      setSummary(built);
      toast.success("Document loaded. Ask a question or download the summary.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read this PDF.");
      setText("");
      setSummary("");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  const ask = () => {
    if (!text) {
      toast.error("Load a PDF first.");
      return;
    }
    if (!question.trim()) {
      toast.error("Type a question first.");
      return;
    }
    setAnswer(answerFromPdfText(text, question));
  };

  const downloadSummary = async () => {
    if (!pdfFile) return;
    setBusy(true);
    try {
      // Prefer already-built summary so short docs still download after Load.
      if (summary) {
        const base = pdfFile.name.replace(/\.pdf$/i, "") || "document";
        downloadResult({
          success: true,
          message: "Summary ready",
          blob: new Blob([summary], { type: "text/plain;charset=utf-8" }),
          filename: `${base}-summary.txt`,
        });
        toast.success("Summary downloaded.");
        return;
      }
      const result = await summarizePdfLocal(pdfFile, (_p, m) => setStatus(m || ""));
      setText(result.text);
      setSummary(result.summary);
      downloadResult({
        success: true,
        message: "Summary ready",
        blob: result.blob,
        filename: result.filename,
      });
      toast.success("Summary downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Summarize failed.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <FileUploader
        files={files}
        onFilesChange={setFiles}
        accept={{ "application/pdf": [".pdf"] }}
        maxFiles={1}
      />
      <p className="text-sm text-muted-foreground">
        Upload a PDF, then click <span className="font-medium text-foreground">Load &amp; summarize</span>.
        Summary and answers stay on your device — no cloud AI.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={load} disabled={!pdfFile || busy}>
          {busy ? status || "Working…" : "Load & summarize"}
        </Button>
        <Button variant="outline" onClick={downloadSummary} disabled={!pdfFile || busy}>
          Download summary (.txt)
        </Button>
      </div>
      {summary && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </p>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-foreground">{summary}</pre>
        </div>
      )}
      {text && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ask about this PDF
          </p>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What is the total amount due?"
            onKeyDown={(e) => e.key === "Enter" && ask()}
          />
          <Button onClick={ask} disabled={!question.trim()}>
            Find answer
          </Button>
          {answer && (
            <Textarea readOnly value={answer} className="min-h-[140px] text-sm" />
          )}
          <p className="text-xs text-muted-foreground">
            Answers are local keyword matches from the PDF text — no cloud AI and no upload.
          </p>
        </div>
      )}
    </div>
  );
};

export default PdfChatPanel;
