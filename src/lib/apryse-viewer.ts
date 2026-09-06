import type { WebViewerInstance } from "@pdftron/webviewer";

/**
 * Where `vite.config.ts` copies `@pdftron/webviewer/public/*` to. WebViewer
 * fetches its wasm and UI html from here at runtime, so this must match the
 * `dest` of the static-copy target.
 */
export const WEBVIEWER_PATH = "/lib/webviewer";

/**
 * A WebViewer licence key is domain-locked and designed to ship to the browser,
 * unlike CLOUDCONVERT_API_KEY, which must stay on the server. Without one the
 * viewer still runs, but stamps a demo watermark on what it renders.
 */
const licenseKey = import.meta.env.VITE_APRYSE_LICENSE_KEY as string | undefined;

export const hasApryseLicense = Boolean(licenseKey);

export interface ViewerHandle {
  instance: WebViewerInstance;
  dispose: () => void;
}

/**
 * Mounts a viewer into `el`. The import is dynamic because WebViewer is a large
 * dependency and only this one tool needs it — a static import would pull it
 * into the entry chunk for every page.
 */
export async function mountApryseViewer(el: HTMLDivElement): Promise<ViewerHandle> {
  const { default: WebViewer } = await import("@pdftron/webviewer");

  const instance = await WebViewer(
    {
      path: WEBVIEWER_PATH,
      licenseKey,
      // Nothing to show until a conversion has run.
      initialDoc: undefined,
      // The document is already in memory; the viewer never needs to reach out.
      isReadOnly: true,
    },
    el
  );

  return {
    instance,
    dispose: () => {
      instance.UI.dispose();
      el.replaceChildren();
    },
  };
}

/** Loads an in-memory file. `extension` is required — a Blob carries no name. */
export function loadBlob(
  instance: WebViewerInstance,
  blob: Blob,
  filename: string,
  extension: string
): void {
  instance.UI.loadDocument(blob, { filename, extension });
}
