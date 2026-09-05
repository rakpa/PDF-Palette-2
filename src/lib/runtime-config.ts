function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getConversionServicePrefix(): string {
  // Vercel services rewrite prefix (prod). In dev, Vite proxy handles /api/*.
  const prefix =
    (import.meta.env as Record<string, string | undefined>).VITE_CONVERSION_PREFIX ??
    "/api/adobe";
  return trimSlash(prefix);
}

/**
 * Adobe PDF Services runs as plain Vercel serverless functions under
 * /api/adobe/*, and the Vite dev server mounts the same handlers, so the path
 * is identical in every environment.
 */
export function adobeApiUrl(name: "health" | "asset" | "job" | "status"): string {
  return `/api/adobe/${name}`;
}

export function conversionServiceUrl(devPath: string, prodPath: string): string {
  const cleanDev = devPath.startsWith("/") ? devPath : `/${devPath}`;
  const cleanProd = prodPath.startsWith("/") ? prodPath : `/${prodPath}`;
  if (!import.meta.env.PROD) return cleanDev;
  return `${getConversionServicePrefix()}${cleanProd}`;
}

/** Word ↔ PDF now go through Adobe on the conversion service in every environment. */
export function useBrowserOfficeConversion(): boolean {
  return false;
}

