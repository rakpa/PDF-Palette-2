import { addPassword, PdfPasswordError } from "./pdf-crypto/document";

/**
 * Add a password to a PDF, in the browser.
 *
 * Uses AES-256 (the standard security handler at revision 6), which is what
 * current readers expect and what qpdf and Acrobat write by default.
 */
export async function protectPdfLocal(
  file: File,
  password: string,
  onProgress?: (progress: number, message?: string) => void
): Promise<{ blob: Blob; filename: string }> {
  const pw = password.trim();
  if (pw.length < 4) throw new Error("Password must be at least 4 characters.");

  onProgress?.(15, "Reading PDF…");
  const bytes = new Uint8Array(await file.arrayBuffer());

  onProgress?.(45, "Encrypting…");
  let output: Uint8Array;
  try {
    output = await addPassword(bytes, { userPassword: pw });
  } catch (error) {
    if (error instanceof PdfPasswordError) throw new Error(error.message);
    throw new Error(
      error instanceof Error ? error.message : "This PDF could not be protected."
    );
  }

  onProgress?.(95, "Preparing download…");
  const baseName = file.name.replace(/\.pdf$/i, "") || "document";
  onProgress?.(100, "Done");
  return {
    blob: new Blob([output], { type: "application/pdf" }),
    filename: `${baseName}_protected.pdf`,
  };
}
