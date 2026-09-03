import type { CompressionLevel } from "./compression-types";

/**
 * Ghostscript settings per level.
 *
 * `settings` is the /PDFSETTINGS preset used as a starting point; every value
 * that matters for fidelity is overridden explicitly afterwards, because the
 * presets are tuned for 2001-era screens: /screen and /ebook drop colour images
 * to 72–150 dpi, re-encode them at QFactor 0.76 with 2×2 chroma subsampling,
 * and convert every colour to sRGB. The last of those is also the single
 * biggest cost in the run — colour-managing every pixel is ~4× slower than
 * leaving the colours alone.
 */
export interface CompressionPreset {
  settings: string;
  /** Downsample colour/grey images above this resolution (dpi). */
  imageDpi: number;
  /** 1-bit images (scanned text) — kept high, this is what readability rides on. */
  monoDpi: number;
  /** JPEG quality for re-encoded images: 0.1 ≈ visually lossless, 0.76 = the preset default. */
  qFactor: number;
}

export const COMPRESSION_PRESETS = {
  low: { settings: "/printer", imageDpi: 300, monoDpi: 600, qFactor: 0.15 },
  recommended: { settings: "/ebook", imageDpi: 200, monoDpi: 300, qFactor: 0.35 },
  extreme: { settings: "/screen", imageDpi: 100, monoDpi: 300, qFactor: 0.55 },
} as const satisfies Record<CompressionLevel, CompressionPreset>;

/**
 * Distiller params for the JPEG encoder. HSamples/VSamples [1 1 1 1] disables
 * chroma subsampling, which is what smears coloured text and thin lines at the
 * presets' default [2 1 1 2].
 */
function imageDictParams(qFactor: number): string {
  const dict =
    `<< /QFactor ${qFactor.toFixed(2)} /Blend 1 ` +
    `/HSamples [1 1 1 1] /VSamples [1 1 1 1] >>`;
  return (
    `<< /ColorACSImageDict ${dict} /ColorImageDict ${dict} ` +
    `/GrayACSImageDict ${dict} /GrayImageDict ${dict} >> setdistillerparams`
  );
}

/** Full Ghostscript command line. Order matters: overrides must follow -dPDFSETTINGS. */
export function buildGhostscriptArgs(
  level: CompressionLevel,
  inputPath: string,
  outputPath: string
): string[] {
  const preset: CompressionPreset = COMPRESSION_PRESETS[level];

  return [
    "-sDEVICE=pdfwrite",
    // 1.4 forces Ghostscript to flatten transparency, which rasterises whole
    // pages of any modern PDF. 1.7 keeps the original constructs.
    "-dCompatibilityLevel=1.7",
    `-dPDFSETTINGS=${preset.settings}`,

    // --- fidelity overrides, all of which must come after the preset ---
    "-dColorConversionStrategy=/LeaveColorUnchanged",

    "-dDownsampleColorImages=true",
    `-dColorImageResolution=${preset.imageDpi}`,
    "-dColorImageDownsampleType=/Bicubic",
    "-dColorImageDownsampleThreshold=1.5",

    "-dDownsampleGrayImages=true",
    `-dGrayImageResolution=${preset.imageDpi}`,
    "-dGrayImageDownsampleType=/Bicubic",
    "-dGrayImageDownsampleThreshold=1.5",

    "-dDownsampleMonoImages=true",
    `-dMonoImageResolution=${preset.monoDpi}`,
    "-dMonoImageDownsampleType=/Subsample",
    "-dMonoImageDownsampleThreshold=1.5",

    "-dAutoFilterColorImages=true",
    "-dAutoFilterGrayImages=true",
    // Leave an already-compressed JPEG alone when it needs no downsampling —
    // re-encoding it would only lose detail.
    "-dPassThroughJPEGImages=true",

    "-dDetectDuplicateImages=true",
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dEmbedAllFonts=true",
    "-dAutoRotatePages=/None",

    "-dNOPAUSE",
    "-dBATCH",
    `-sOutputFile=${outputPath}`,
    // -c … -f must be last: everything after -f is read as an input file.
    "-c",
    imageDictParams(preset.qFactor),
    "-f",
    inputPath,
  ];
}
