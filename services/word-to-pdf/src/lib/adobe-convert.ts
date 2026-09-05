import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import {
  ADOBE_MEDIA,
  AdobeConversionError,
  convertAssetWithAdobe,
  type AdobeCredentials,
} from "./adobe-pdf-services.js";
import { validateOfficeFile } from "./office-file-validator.js";
import { validatePdfFile } from "./pdf-file-validator.js";

export function adobeCredentialsFromConfig(config: AppConfig): AdobeCredentials | null {
  if (config.PDF_SERVICES_CLIENT_ID && config.PDF_SERVICES_CLIENT_SECRET) {
    return {
      clientId: config.PDF_SERVICES_CLIENT_ID,
      clientSecret: config.PDF_SERVICES_CLIENT_SECRET,
    };
  }
  return null;
}

export function adobeConfigured(config: AppConfig): boolean {
  return adobeCredentialsFromConfig(config) !== null;
}

function requireAdobe(config: AppConfig): AdobeCredentials {
  const credentials = adobeCredentialsFromConfig(config);
  if (!credentials) {
    throw new AdobeConversionError(
      "Adobe PDF Services is not configured. Set PDF_SERVICES_CLIENT_ID and PDF_SERVICES_CLIENT_SECRET.",
      503
    );
  }
  return credentials;
}

function mediaTypeForWord(filename: string): string {
  return /\.doc$/i.test(filename) && !/\.docx$/i.test(filename)
    ? ADOBE_MEDIA.doc
    : ADOBE_MEDIA.docx;
}

export async function convertWordToPdfAdobe(
  inputPath: string,
  outputPath: string,
  originalName: string,
  config: AppConfig,
  log: Logger
): Promise<{ pageCount: number; byteLength: number; pdfFilename: string }> {
  const credentials = requireAdobe(config);
  const validation = await validateOfficeFile(inputPath);
  if (!validation.ok) {
    throw new AdobeConversionError(validation.message, 422);
  }

  log.info({ originalName }, "adobe word-to-pdf started");
  await convertAssetWithAdobe({
    credentials,
    inputPath,
    outputPath,
    mediaType: mediaTypeForWord(originalName),
    operation: "createpdf",
    timeoutMs: config.CONVERSION_TIMEOUT_MS,
  });

  const pdfValidation = await validatePdfFile(outputPath);
  if (!pdfValidation.ok) {
    throw new AdobeConversionError(pdfValidation.message, 500);
  }

  const pdfFilename = path.basename(originalName, path.extname(originalName)) + ".pdf";
  log.info(
    { pdfFilename, pageCount: pdfValidation.pageCount, bytes: pdfValidation.byteLength },
    "adobe word-to-pdf completed"
  );
  return {
    pageCount: pdfValidation.pageCount,
    byteLength: pdfValidation.byteLength,
    pdfFilename,
  };
}

export async function convertPdfToWordAdobe(
  inputPath: string,
  outputPath: string,
  originalName: string,
  config: AppConfig,
  log: Logger
): Promise<{ byteLength: number; docxFilename: string }> {
  const credentials = requireAdobe(config);
  const validation = await validatePdfFile(inputPath);
  if (!validation.ok) {
    throw new AdobeConversionError(validation.message, 422);
  }

  log.info({ originalName, pages: validation.pageCount }, "adobe pdf-to-word started");
  await convertAssetWithAdobe({
    credentials,
    inputPath,
    outputPath,
    mediaType: ADOBE_MEDIA.pdf,
    operation: "exportpdf",
    targetFormat: "docx",
    timeoutMs: config.CONVERSION_TIMEOUT_MS,
  });

  const officeValidation = await validateOfficeFile(outputPath);
  if (!officeValidation.ok) {
    throw new AdobeConversionError(officeValidation.message, 500);
  }

  const docxFilename = path.basename(originalName, path.extname(originalName)) + ".docx";
  const stat = await fs.stat(outputPath);
  log.info({ docxFilename, bytes: stat.size }, "adobe pdf-to-word completed");
  return { byteLength: stat.size, docxFilename };
}
