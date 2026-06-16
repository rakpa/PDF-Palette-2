import { conversionServiceUrl, useBrowserOfficeConversion } from "./runtime-config";

export type ConversionHealth = {
  status: "ok" | "degraded" | "unavailable";
  checks?: {
    libreOffice?: boolean;
    python?: boolean;
  };
  message?: string;
};

export type ConversionFeature =
  | "word-to-pdf"
  | "pdf-to-word"
  | "unlock-pdf"
  | "protect-pdf"
  | "html-to-pdf";

const SERVICE_DOWN_MESSAGE =
  "Conversion service is not running. Stop the app and run: npm run dev (starts both the website and conversion service).";

export function parseConversionFetchError(error: unknown): string {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    if (msg.includes("failed to fetch") || msg.includes("network")) {
      return SERVICE_DOWN_MESSAGE;
    }
  }
  if (error instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
      return SERVICE_DOWN_MESSAGE;
    }
    return error.message;
  }
  return "Conversion failed";
}

export async function checkConversionHealth(): Promise<ConversionHealth> {
  try {
    const res = await fetch(conversionServiceUrl("/api/conversion/health", "/health"), {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      checks?: ConversionHealth["checks"];
    };
    const checks = data.checks;

    if (!res.ok && !checks) {
      return {
        status: "unavailable",
        message: SERVICE_DOWN_MESSAGE,
      };
    }

    return {
      status: data.status === "ok" ? "ok" : "degraded",
      checks,
      message: buildHealthMessage(checks),
    };
  } catch {
    return {
      status: "unavailable",
      message: SERVICE_DOWN_MESSAGE,
    };
  }
}

export function isConversionReady(
  health: ConversionHealth | null,
  feature: ConversionFeature
): boolean {
  // Word/PDF office conversions run in the browser on Vercel (no LibreOffice/Python).
  if (useBrowserOfficeConversion() && (feature === "word-to-pdf" || feature === "pdf-to-word")) {
    return true;
  }

  if (!health) return false;
  if (health.status === "unavailable") return false;

  // Tools that need a specific runtime dependency.
  if (feature === "word-to-pdf") return health.checks?.libreOffice !== false;
  if (feature === "pdf-to-word") return health.checks?.python !== false;

  // For unlock/protect/html-to-pdf we only need the service reachable.
  return true;
}

export function conversionBlockedMessage(
  health: ConversionHealth | null,
  feature: ConversionFeature
): string | undefined {
  if (useBrowserOfficeConversion() && (feature === "word-to-pdf" || feature === "pdf-to-word")) {
    return undefined;
  }

  if (!health || health.status === "unavailable") {
    return health?.message || SERVICE_DOWN_MESSAGE;
  }
  if (feature === "word-to-pdf" && health.checks?.libreOffice === false) {
    return "LibreOffice is not installed. Install LibreOffice for Word → PDF conversion.";
  }
  if (feature === "pdf-to-word" && health.checks?.python === false) {
    return "Python dependencies missing. Run: npm run setup:python";
  }
  return undefined;
}

function buildHealthMessage(checks?: ConversionHealth["checks"]): string | undefined {
  if (!checks) return undefined;
  const issues: string[] = [];
  if (checks.libreOffice === false) {
    issues.push("LibreOffice is not installed (required for Word → PDF)");
  }
  if (checks.python === false) {
    issues.push("Python dependencies missing (run: npm run setup:python)");
  }
  return issues.length > 0 ? issues.join(". ") : undefined;
}
