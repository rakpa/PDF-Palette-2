import { convertPdfToWordIlove } from "./ilovepdf-direct";

export async function convertPdfToWordViaIlove(
  file: File,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const result = await convertPdfToWordIlove(file, onProgress);
  return { blob: result.blob, filename: result.filename };
}
