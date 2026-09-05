import { convertFileViaCloudConvert } from "./cloudconvert-direct";
import { pinCoverImage, prepareCoverFromPdf } from "./docx-cover";
import { repairDocxRules } from "./docx-rules";

const PDF_MEDIA = "application/pdf";

export async function convertPdfToWordLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  // Render a cover candidate while CloudConvert works so this adds no wait.
  const coverTask = prepareCoverFromPdf(file);
  const result = await convertFileViaCloudConvert({
    file,
    mediaType: PDF_MEDIA,
    kind: "pdf-to-word",
    onProgress,
    uploadingMessage: "Uploading PDF to CloudConvert…",
    convertingMessage: "Converting with CloudConvert…",
  });
  const repaired = await repairDocxRules(result.blob);
  const cover = await coverTask;
  const blob = cover ? await pinCoverImage(repaired, cover) : repaired;
  return { ...result, blob };
}
