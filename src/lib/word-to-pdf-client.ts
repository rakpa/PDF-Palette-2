import { convertFileViaCloudConvert } from "./cloudconvert-direct";

function mediaTypeForWord(name: string): string {
  return /\.doc$/i.test(name) && !/\.docx$/i.test(name)
    ? "application/msword"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export async function convertWordToPdfLocal(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  return convertFileViaCloudConvert({
    file,
    mediaType: mediaTypeForWord(file.name),
    kind: "word-to-pdf",
    onProgress,
    uploadingMessage: "Uploading document to CloudConvert…",
    convertingMessage: "Converting with CloudConvert…",
  });
}
