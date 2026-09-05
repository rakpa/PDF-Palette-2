import { convertFileViaAdobe } from "./adobe-direct";
import { conversionServiceUrl } from "./runtime-config";

const PDF_MEDIA = "application/pdf";

export async function convertPdfToWordLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  return convertFileViaAdobe({
    file,
    mediaType: PDF_MEDIA,
    assetUrl: conversionServiceUrl("/api/pdf-to-word/asset", "/v1/pdf-to-word/asset"),
    jobsUrl: conversionServiceUrl("/api/pdf-to-word/jobs", "/v1/pdf-to-word/jobs"),
    onProgress,
    uploadingMessage: "Uploading PDF to Adobe…",
    convertingMessage: "Converting with Adobe PDF Services…",
  });
}
