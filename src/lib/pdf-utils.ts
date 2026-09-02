import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { saveAs } from "file-saver";
import {
  compressWithGhostscript,
} from "./ghostscript-compress";
import { convertWordToPdfLocal } from "./word-to-pdf-client";
import { convertPdfToWordLocal } from "./pdf-to-word-client";
import { convertWordToPdfBrowser } from "./word-to-pdf-browser";
import { convertPdfToWordBrowser } from "./pdf-to-word-browser";
import { useBrowserOfficeConversion } from "./runtime-config";
import { unlockPdfLocal } from "./unlock-pdf-client";
import { protectPdfLocal } from "./protect-pdf-client";
import { htmlToPdfLocal } from "./html-to-pdf-client";
import type { CompressionLevel } from "./compression-types";

export type { CompressionLevel };

export interface ProcessingResult {
  success: boolean;
  message: string;
  blob?: Blob;
  filename?: string;
}

// Merge multiple PDFs into one
export async function mergePDFs(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<ProcessingResult> {
  try {
    const mergedPdf = await PDFDocument.create();
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await PDFDocument.load(arrayBuffer);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
      
      onProgress?.(((i + 1) / files.length) * 100);
    }

    const pdfBytes = await mergedPdf.save();
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
    
    return {
      success: true,
      message: "PDFs merged successfully!",
      blob,
      filename: "merged.pdf",
    };
  } catch (error) {
    return {
      success: false,
      message: `Error merging PDFs: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// Split PDF into individual pages or ranges
export async function splitPDF(
  file: File,
  ranges: { start: number; end: number }[],
  onProgress?: (progress: number) => void
): Promise<ProcessingResult[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pageCount = pdf.getPageCount();
    const results: ProcessingResult[] = [];

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      const pageIndices = [];

      for (let p = range.start - 1; p < range.end; p++) {
        if (p >= 0 && p < pageCount) {
          pageIndices.push(p);
        }
      }

      // Skip ranges that don't map to any real page instead of emitting an empty PDF.
      if (pageIndices.length === 0) {
        results.push({
          success: false,
          message: `Pages ${range.start}-${range.end} are out of range (document has ${pageCount} page${pageCount === 1 ? "" : "s"}).`,
        });
        onProgress?.(((i + 1) / ranges.length) * 100);
        continue;
      }

      const newPdf = await PDFDocument.create();
      const pages = await newPdf.copyPages(pdf, pageIndices);
      pages.forEach((page) => newPdf.addPage(page));
      
      const pdfBytes = await newPdf.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      
      results.push({
        success: true,
        message: `Pages ${range.start}-${range.end} extracted`,
        blob,
        filename: `split_${range.start}-${range.end}.pdf`,
      });
      
      onProgress?.(((i + 1) / ranges.length) * 100);
    }
    
    return results;
  } catch (error) {
    return [{
      success: false,
      message: `Error splitting PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
    }];
  }
}

// Rotate PDF pages
export async function rotatePDF(
  file: File,
  rotation: 90 | 180 | 270,
  pageIndices?: number[], // If undefined, rotate all pages
  onProgress?: (progress: number) => void
): Promise<ProcessingResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pages = pdf.getPages();
    const indicesToRotate = pageIndices ?? pages.map((_, i) => i);
    
    for (let i = 0; i < indicesToRotate.length; i++) {
      const pageIndex = indicesToRotate[i];
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const page = pages[pageIndex];
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees((currentRotation + rotation) % 360));
      }
      onProgress?.(((i + 1) / indicesToRotate.length) * 100);
    }
    
    const pdfBytes = await pdf.save();
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
    
    return {
      success: true,
      message: "PDF rotated successfully!",
      blob,
      filename: `rotated_${file.name}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error rotating PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// Compress PDF in-browser via Ghostscript WASM (no external API).
export async function compressPDF(
  file: File,
  level: CompressionLevel = "recommended",
  onProgress?: (progress: number) => void
): Promise<ProcessingResult> {
  try {
    const { blob, inputSize, outputSize } = await compressWithGhostscript(
      file,
      level,
      onProgress
    );

    const useOriginal = outputSize >= inputSize;
    const finalBlob = useOriginal ? file : blob;
    const finalSize = useOriginal ? inputSize : outputSize;
    const reductionPct = ((inputSize - finalSize) / inputSize) * 100;

    let message: string;
    if (reductionPct < 0.5) {
      message = `This PDF is already well-optimized — kept at ${formatFileSize(finalSize)}.`;
    } else {
      message = `Compressed! Reduced by ${reductionPct.toFixed(1)}% (${formatFileSize(
        inputSize
      )} → ${formatFileSize(finalSize)})`;
    }

    return {
      success: true,
      message,
      blob: finalBlob,
      filename: `compressed_${file.name}`,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return {
      success: false,
      message: `Error compressing PDF: ${detail}`,
    };
  }
}

// Protect PDF with password.
// NOTE: pdf-lib cannot encrypt documents, so there is no honest way to do this
// fully in the browser. This intentionally returns a failure (no download) so we
// never hand the user an *unencrypted* file that looks protected. The "Protect PDF"
// tool is flagged `comingSoon` until a server-side encryption step exists.
export async function protectPDF(): Promise<ProcessingResult> {
  return {
    success: false,
    message:
      "Password protection needs secure server-side encryption, which isn't available yet. Coming soon!",
  };
}

export async function unlockPDF(
  file: File,
  password: string,
  onProgress?: (progress: number, message?: string) => void
): Promise<ProcessingResult> {
  try {
    const { blob, filename } = await unlockPdfLocal(file, password, onProgress);
    return {
      success: true,
      message: "PDF unlocked successfully!",
      blob,
      filename,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return {
      success: false,
      message: `Error unlocking PDF: ${detail}`,
    };
  }
}

export async function protectPDFWithPassword(
  file: File,
  password: string,
  onProgress?: (progress: number, message?: string) => void
): Promise<ProcessingResult> {
  try {
    const { blob, filename } = await protectPdfLocal(file, password, onProgress);
    return {
      success: true,
      message: "Password protection added!",
      blob,
      filename,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return {
      success: false,
      message: `Error protecting PDF: ${detail}`,
    };
  }
}

export async function htmlToPDF(
  input: { file?: File; url?: string },
  onProgress?: (progress: number, message?: string) => void
): Promise<ProcessingResult> {
  try {
    const { blob, filename } = await htmlToPdfLocal(input, onProgress);
    return {
      success: true,
      message: "PDF generated successfully!",
      blob,
      filename,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return {
      success: false,
      message: `Error converting HTML: ${detail}`,
    };
  }
}

// Add watermark to PDF
export async function addWatermark(
  file: File,
  text: string,
  options: {
    fontSize?: number;
    opacity?: number;
    rotation?: number;
  } = {},
  onProgress?: (progress: number) => void
): Promise<ProcessingResult> {
  try {
    const { fontSize = 50, opacity = 0.3, rotation = -45 } = options;

    onProgress?.(10);
    const arrayBuffer = await file.arrayBuffer();
    onProgress?.(30);

    const pdf = await PDFDocument.load(arrayBuffer);
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pages = pdf.getPages();

    onProgress?.(50);

    const angle = (rotation * Math.PI) / 180;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();

      // Offset the draw origin so the rotated text stays centered on the page.
      const x = width / 2 - (textWidth / 2) * Math.cos(angle) + (textHeight / 2) * Math.sin(angle);
      const y = height / 2 - (textWidth / 2) * Math.sin(angle) - (textHeight / 2) * Math.cos(angle);

      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity,
        rotate: degrees(rotation),
      });

      onProgress?.(50 + ((i + 1) / pages.length) * 40);
    }
    
    const pdfBytes = await pdf.save();
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
    
    onProgress?.(100);
    
    return {
      success: true,
      message: "Watermark added successfully!",
      blob,
      filename: `watermarked_${file.name}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Error adding watermark: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// Get PDF info
export async function getPDFInfo(file: File): Promise<{
  pageCount: number;
  title?: string;
  author?: string;
}> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  
  return {
    pageCount: pdf.getPageCount(),
    title: pdf.getTitle(),
    author: pdf.getAuthor(),
  };
}

// Download result
export function downloadResult(result: ProcessingResult) {
  if (result.blob && result.filename) {
    saveAs(result.blob, result.filename);
  }
}

// Utility: Format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// Convert Word documents to PDF (LibreOffice locally, browser fallback on Vercel).
export async function wordToPDF(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<ProcessingResult> {
  try {
    const { blob, filename } = useBrowserOfficeConversion()
      ? await convertWordToPdfBrowser(file, onProgress)
      : await convertWordToPdfLocal(file, onProgress);
    return {
      success: true,
      message: useBrowserOfficeConversion()
        ? "Word document converted to PDF in your browser!"
        : "Word document converted to PDF successfully!",
      blob,
      filename,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return {
      success: false,
      message: `Error converting document: ${detail}`,
    };
  }
}

// Convert PDF to Word (Python/pdf2docx locally, browser fallback on Vercel).
export async function pdfToWord(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<ProcessingResult> {
  try {
    const { blob, filename } = useBrowserOfficeConversion()
      ? await convertPdfToWordBrowser(file, onProgress)
      : await convertPdfToWordLocal(file, onProgress);
    return {
      success: true,
      message: "PDF converted to Word successfully!",
      blob,
      filename,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    return {
      success: false,
      message: `Error converting PDF: ${detail}`,
    };
  }
}

// Convert images to PDF
export async function imagesToPDF(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<ProcessingResult> {
  try {
    const pdf = await PDFDocument.create();
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const arrayBuffer = await file.arrayBuffer();
      
      let image;
      if (file.type === "image/jpeg" || file.type === "image/jpg") {
        image = await pdf.embedJpg(arrayBuffer);
      } else if (file.type === "image/png") {
        image = await pdf.embedPng(arrayBuffer);
      } else {
        continue; // Skip unsupported formats
      }
      
      const page = pdf.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
      
      onProgress?.(((i + 1) / files.length) * 100);
    }
    
    const pdfBytes = await pdf.save();
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
    
    return {
      success: true,
      message: "Images converted to PDF successfully!",
      blob,
      filename: "images.pdf",
    };
  } catch (error) {
    return {
      success: false,
      message: `Error converting images: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
