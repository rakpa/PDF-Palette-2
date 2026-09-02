import { PdfPasswordError, removePassword } from "./pdf-crypto/document";

/**
 * Remove a PDF's password, in the browser.
 *
 * Accepts either the user or the owner password, and handles every revision of
 * the standard security handler that readers still encounter: RC4 40- and
 * 128-bit, AES-128 and AES-256.
 */
export async function unlockPdfLocal(
  file: File,
  password: string,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const pw = password.trim();
  if (!pw) throw new Error("Password is required.");

  onProgress?.(15, "Reading PDF…");
  const bytes = new Uint8Array(await file.arrayBuffer());

  onProgress?.(45, "Removing protection…");
  let output: Uint8Array;
  try {
    output = await removePassword(bytes, pw);
  } catch (error) {
    if (error instanceof PdfPasswordError) throw new Error(error.message);
    throw new Error(error instanceof Error ? error.message : "This PDF could not be unlocked.");
  }

  onProgress?.(95, "Preparing download…");
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  onProgress?.(100, "Done");
  return {
    blob: new Blob([output], { type: "application/pdf" }),
    filename: `${baseName}_unlocked.pdf`,
  };
}
