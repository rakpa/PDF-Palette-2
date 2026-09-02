import { CONTENT_HEIGHT_PX, CONTENT_WIDTH_PX } from "./types";

export interface LoadedFrame {
  frame: HTMLIFrameElement;
  doc: Document;
  contentHeight: number;
  dispose: () => void;
}

function waitForImages(doc: Document, timeoutMs: number): Promise<void> {
  const pending = Array.from(doc.images).filter((img) => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
      )
    ).then(() => undefined),
    new Promise<void>((resolve) => { window.setTimeout(resolve, timeoutMs); }),
  ]);
}

/**
 * Turn images into data URIs.
 *
 * The faithful capture path renders the document inside an SVG, and an SVG
 * cannot fetch anything from the network — so an image that is still a URL
 * would silently vanish. Each one is re-fetched through a second, CORS-enabled
 * request and redrawn to inline it. A server that does not allow that leaves
 * the page exactly as it was: the image still lays out, it just cannot be
 * carried into the capture.
 */
async function inlineImages(doc: Document): Promise<void> {
  await Promise.all(
    Array.from(doc.images).map(async (img) => {
      const src = img.src;
      if (!src || src.startsWith("data:")) return;

      const source = await new Promise<HTMLImageElement | null>((resolve) => {
        const probe = new Image();
        probe.crossOrigin = "anonymous";
        probe.addEventListener("load", () => resolve(probe), { once: true });
        probe.addEventListener("error", () => resolve(null), { once: true });
        probe.src = src;
      });
      if (!source || source.naturalWidth === 0) return;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = source.naturalWidth;
        canvas.height = source.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(source, 0, 0);
        img.src = canvas.toDataURL("image/png");
      } catch {
        // Tainted despite the CORS request; leave the original URL in place.
      }
    })
  );
}

/** Remove anything executable or navigable before the document is measured. */
function stripUnsafeContent(doc: Document): void {
  doc.querySelectorAll("script, object, embed, iframe, frame").forEach((el) => el.remove());
  // Inline handlers cannot fire in a script-free sandbox, but strip them anyway
  // so nothing survives into a context that does allow scripts.
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
  });
}

/**
 * Lay the HTML out with the browser's own engine, inside a sandbox that cannot
 * run scripts. The frame is sized to the printable width of an A4 page so the
 * layout the user gets is the layout that reaches the PDF.
 */
export async function loadHtmlFrame(html: string): Promise<LoadedFrame> {
  const frame = document.createElement("iframe");
  // Same-origin so we can read the layout back; no allow-scripts, so the file
  // is inert. (The sandbox escape warning applies only when both are set.)
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${CONTENT_WIDTH_PX}px`,
    `height:${CONTENT_HEIGHT_PX}px`,
    "border:0",
    "opacity:0",
    "pointer-events:none",
    "z-index:-1",
  ].join(";");
  document.body.appendChild(frame);

  const dispose = () => frame.remove();

  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("This browser would not lay the page out.");

    doc.open();
    doc.write(html);
    doc.close();

    stripUnsafeContent(doc);

    if (!doc.body) throw new Error("That file does not contain a readable HTML page.");

    // A white sheet, and no scrollbar stealing layout width.
    const sheet = doc.createElement("style");
    sheet.textContent =
      "html,body{background:#fff !important;}" +
      "html{overflow-x:hidden;}" +
      "body{overflow-x:hidden;}" +
      "*{scrollbar-width:none;}" +
      "::-webkit-scrollbar{display:none;}";
    doc.head?.appendChild(sheet);

    await waitForImages(doc, 10000);
    await inlineImages(doc);
    if (doc.fonts?.ready) {
      await Promise.race([
        doc.fonts.ready,
        new Promise((resolve) => { window.setTimeout(resolve, 4000); }),
      ]);
    }
    // Let layout settle before measuring.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const contentHeight = Math.max(
      doc.body.scrollHeight,
      doc.documentElement.scrollHeight,
      doc.body.getBoundingClientRect().height,
      1
    );

    // Grow the frame so nothing is clipped or lazily skipped during capture.
    frame.style.height = `${Math.ceil(contentHeight)}px`;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    return { frame, doc, contentHeight, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
