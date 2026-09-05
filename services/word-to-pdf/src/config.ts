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

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${message}`);
  }
  return parsed.data;
}
