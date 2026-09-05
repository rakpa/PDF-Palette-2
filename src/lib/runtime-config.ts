function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getConversionServicePrefix(): string {
  // Vercel services rewrite prefix (prod). In dev, Vite proxy handles /api/*.
  const prefix =
    (import.meta as any).env?.VITE_CONVERSION_PREFIX ??
    "/api/adobe";
  return trimSlash(prefix);
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

