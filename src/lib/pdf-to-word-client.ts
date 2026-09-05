import { convertFileViaAdobe } from "./adobe-direct";
import { repairAdobeDocxRules } from "./adobe-docx-rules";


const PDF_MEDIA = "application/pdf";

export async function convertPdfToWordLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const result = await convertFileViaAdobe({
    file,
    mediaType: PDF_MEDIA,
    kind: "pdf-to-word",
    onProgress,
    uploadingMessage: "Uploading PDF to Adobe…",
    convertingMessage: "Converting with Adobe PDF Services…",
  });
  return { ...result, blob: await repairAdobeDocxRules(result.blob) };
}
