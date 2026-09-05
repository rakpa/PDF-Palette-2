function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getConversionServicePrefix(): string {
  // Vercel services rewrite prefix (prod). In dev, Vite proxy handles /api/*.
  const prefix =
    (import.meta.env as Record<string, string | undefined>).VITE_CONVERSION_PREFIX ??
    "/api/convert";
  return trimSlash(prefix);
}

/**
 * CloudConvert runs as plain Vercel serverless functions under
 * /api/convert/*, and the Vite dev server mounts the same handlers, so the path
 * is identical in every environment.
 */
export function convertApiUrl(name: "health" | "asset" | "job" | "status"): string {
  return `/api/convert/${name}`;
}

export function conversionServiceUrl(devPath: string, prodPath: string): string {
  const cleanDev = devPath.startsWith("/") ? devPath : `/${devPath}`;
  const cleanProd = prodPath.startsWith("/") ? prodPath : `/${prodPath}`;
  if (!import.meta.env.PROD) return cleanDev;
  return `${getConversionServicePrefix()}${cleanProd}`;
}

/** Word ↔ PDF now go through CloudConvert in every environment. */
export function useBrowserOfficeConversion(): boolean {
  return false;
}
