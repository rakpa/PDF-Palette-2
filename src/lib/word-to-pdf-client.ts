import { convertFileViaAdobe } from "./adobe-direct";
import { conversionServiceUrl } from "./runtime-config";

function mediaTypeForWord(name: string): string {
  return /\.doc$/i.test(name) && !/\.docx$/i.test(name)
    ? "application/msword"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export async function convertWordToPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  return convertFileViaAdobe({
    file,
    mediaType: mediaTypeForWord(file.name),
    assetUrl: conversionServiceUrl("/api/word-to-pdf/asset", "/v1/word-to-pdf/asset"),
    jobsUrl: conversionServiceUrl("/api/word-to-pdf/jobs", "/v1/word-to-pdf/jobs"),
    onProgress,
    uploadingMessage: "Uploading document to Adobe…",
    convertingMessage: "Converting with Adobe PDF Services…",
  });
}
