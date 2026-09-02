import { conversionServiceUrl } from "./runtime-config";

export type ConversionHealth = {
  status: "ok" | "degraded" | "unavailable";
  checks?: {
    libreOffice?: boolean;
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
  // PDF → Word and Word → PDF are rebuilt in the browser and never touch this service.
  if (feature === "pdf-to-word" || feature === "word-to-pdf") return true;

  if (!health) return false;
  if (health.status === "unavailable") return false;

  // For unlock/protect/html-to-pdf we only need the service reachable.
  return true;
}

export function conversionBlockedMessage(
  health: ConversionHealth | null,
  feature: ConversionFeature
): string | undefined {
  if (feature === "pdf-to-word" || feature === "word-to-pdf") {
    return undefined;
  }

  if (!health || health.status === "unavailable") {
    return health?.message || SERVICE_DOWN_MESSAGE;
  }
  return undefined;
}

function buildHealthMessage(checks?: ConversionHealth["checks"]): string | undefined {
  if (!checks) return undefined;
  const issues: string[] = [];
  if (checks.libreOffice === false) {
    issues.push("LibreOffice is not installed");
  }
  return issues.length > 0 ? issues.join(". ") : undefined;
}
