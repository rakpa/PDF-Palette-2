import { conversionServiceUrl } from "./runtime-config";

export type ConversionHealth = {
  status: "ok" | "degraded" | "unavailable";
  checks?: {
    adobe?: boolean;
    libreOffice?: boolean;
  };
  message?: string;
};

export class ConversionServiceError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "rejected" | "failed"
  ) {
    super(message);
    this.name = "ConversionServiceError";
  }
}

export type ConversionFeature =
  | "word-to-pdf"
  | "pdf-to-word"
  | "unlock-pdf"
  | "protect-pdf"
  | "html-to-pdf";

const SERVICE_DOWN_MESSAGE =
  "Conversion service is not running. Stop the app and run: npm run dev (starts both the website and conversion service).";

export function serviceErrorFromFetch(error: unknown): ConversionServiceError {
  return new ConversionServiceError(parseConversionFetchError(error), "unavailable");
}

export function serviceErrorFromResponse(
  status: number,
  message: string
): ConversionServiceError {
  if (status === 413) {
    return new ConversionServiceError(
      message || "This file is too large to send through the conversion service.",
      "failed"
    );
  }
  if (status === 503 || status === 502 || status === 504) {
    return new ConversionServiceError(message, "unavailable");
  }
  if (status >= 400 && status < 500) {
    return new ConversionServiceError(message, "rejected");
  }
  return new ConversionServiceError(message, "failed");
}

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
  // Everything except HTML → PDF now runs in the browser and never touches
  // this service. HTML → PDF still needs a real browser engine server-side.
  if (feature !== "html-to-pdf") return true;

  if (!health) return false;
  return health.status !== "unavailable";
}

export function conversionBlockedMessage(
  health: ConversionHealth | null,
  feature: ConversionFeature
): string | undefined {
  if (feature !== "html-to-pdf") return undefined;

  if (!health || health.status === "unavailable") {
    return health?.message || SERVICE_DOWN_MESSAGE;
  }
  return undefined;
}

function buildHealthMessage(checks?: ConversionHealth["checks"]): string | undefined {
  if (!checks) return undefined;
  const issues: string[] = [];
  if (checks.adobe === false) {
    issues.push("Adobe PDF Services is not configured");
  }
  if (checks.libreOffice === false) {
    issues.push("LibreOffice is not installed");
  }
  return issues.length > 0 ? issues.join(". ") : undefined;
}
