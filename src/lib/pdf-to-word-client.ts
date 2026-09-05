import { convertFileViaCloudConvert } from "./cloudconvert-direct";
import { repairDocxRules } from "./docx-rules";

const PDF_MEDIA = "application/pdf";

export async function convertPdfToWordLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const result = await convertFileViaCloudConvert({
    file,
    mediaType: PDF_MEDIA,
    kind: "pdf-to-word",
    onProgress,
    uploadingMessage: "Uploading PDF to CloudConvert…",
    convertingMessage: "Converting with CloudConvert…",
  });
  return { ...result, blob: await repairDocxRules(result.blob) };
}
