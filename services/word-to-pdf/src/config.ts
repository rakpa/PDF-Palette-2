import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  SOFFICE_PATH: z.string().optional(),
  QPDF_PATH: z.string().optional(),
  TEMP_ROOT: z.string().default(process.platform === "win32" ? "C:\\temp\\pdf-palette" : "/tmp/pdf-palette"),
  MAX_UPLOAD_BYTES: z.coerce.number().default(100 * 1024 * 1024),
  CONVERSION_TIMEOUT_MS: z.coerce.number().default(5 * 60 * 1000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:8080"),
  PDF_SERVICES_CLIENT_ID: z.string().optional(),
  PDF_SERVICES_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

function stripWrap(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^['"]+|['"]+$/g, "").trim();
}

function credentialsFromJson(raw: string): { id: string; secret: string } | null {
  try {
    const parsed = JSON.parse(raw) as {
      client_credentials?: { client_id?: string; client_secret?: string };
      client_id?: string;
      client_secret?: string;
    };
    const id = stripWrap(parsed.client_credentials?.client_id ?? parsed.client_id);
    const secret = stripWrap(parsed.client_credentials?.client_secret ?? parsed.client_secret);
    return id && secret ? { id, secret } : null;
  } catch {
    return null;
  }
}

export function adobeCredentialsFromEnv(): { clientId: string; clientSecret: string } | null {
  const id = stripWrap(process.env.PDF_SERVICES_CLIENT_ID);
  const secret = stripWrap(process.env.PDF_SERVICES_CLIENT_SECRET);
  if (id && secret && !id.startsWith("{")) {
    return { clientId: id, clientSecret: secret };
  }

  for (const raw of [
    process.env.PDF_SERVICES_CREDENTIALS_JSON,
    process.env.PDF_SERVICES_CLIENT_ID,
    process.env.PDF_SERVICES_CREDENTIALS,
  ]) {
    if (!raw) continue;
    const fromJson = credentialsFromJson(raw);
    if (fromJson) {
      return { clientId: fromJson.id, clientSecret: fromJson.secret };
    }
  }
  return null;
}

export function loadConfig(): AppConfig {
  const env = { ...process.env };
  if (env.NODE_ENV && !["development", "production", "test"].includes(env.NODE_ENV)) {
    env.NODE_ENV = process.env.VERCEL ? "production" : "development";
  }
  if (env.LOG_LEVEL && !["fatal", "error", "warn", "info", "debug", "trace"].includes(env.LOG_LEVEL)) {
    delete env.LOG_LEVEL;
  }
  for (const key of ["PORT", "MAX_UPLOAD_BYTES", "CONVERSION_TIMEOUT_MS"] as const) {
    if (env[key] && Number.isNaN(Number(env[key]))) delete env[key];
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const adobe = adobeCredentialsFromEnv();
    return {
      NODE_ENV: process.env.VERCEL ? "production" : "development",
      PORT: 3001,
      TEMP_ROOT: "/tmp/pdf-palette",
      MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
      CONVERSION_TIMEOUT_MS: 5 * 60 * 1000,
      LOG_LEVEL: "info",
      CORS_ORIGIN: "http://localhost:8080",
      PDF_SERVICES_CLIENT_ID: adobe?.clientId,
      PDF_SERVICES_CLIENT_SECRET: adobe?.clientSecret,
    };
  }

  const adobe = adobeCredentialsFromEnv();
  return {
    ...parsed.data,
    PDF_SERVICES_CLIENT_ID: adobe?.clientId ?? (stripWrap(parsed.data.PDF_SERVICES_CLIENT_ID) || undefined),
    PDF_SERVICES_CLIENT_SECRET:
      adobe?.clientSecret ?? (stripWrap(parsed.data.PDF_SERVICES_CLIENT_SECRET) || undefined),
  };
}
