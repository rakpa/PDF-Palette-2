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
  CLOUDCONVERT_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

function stripWrap(value: string | undefined): string {
  if (!value) return "";
  return value.trim().replace(/^['"]+|['"]+$/g, "").trim();
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
    return {
      NODE_ENV: process.env.VERCEL ? "production" : "development",
      PORT: 3001,
      TEMP_ROOT: "/tmp/pdf-palette",
      MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
      CONVERSION_TIMEOUT_MS: 5 * 60 * 1000,
      LOG_LEVEL: "info",
      CORS_ORIGIN: "http://localhost:8080",
      CLOUDCONVERT_API_KEY: stripWrap(process.env.CLOUDCONVERT_API_KEY) || undefined,
    };
  }

  return {
    ...parsed.data,
    CLOUDCONVERT_API_KEY: stripWrap(parsed.data.CLOUDCONVERT_API_KEY) || undefined,
  };
}
