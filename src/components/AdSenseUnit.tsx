import { useEffect, useRef } from "react";
import {
  ADSENSE_AUTO,
  ADSENSE_CLIENT,
  adsenseEnabled,
  slotForPlacement,
  type AdPlacement,
} from "@/lib/monetization";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

let scriptLoading: Promise<void> | null = null;
let autoAdsBootstrapped = false;

function loadAdSense(): Promise<void> {
  if (!adsenseEnabled()) return Promise.resolve();
  if (document.querySelector(`script[data-pdf-palette-adsense="1"]`)) {
    return Promise.resolve();
  }
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`;
    script.crossOrigin = "anonymous";
    script.dataset.pdfPaletteAdsense = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("AdSense failed to load"));
    document.head.appendChild(script);
  });
  return scriptLoading;
}

function enableAutoAds() {
  if (!ADSENSE_AUTO || autoAdsBootstrapped || !adsenseEnabled()) return;
  autoAdsBootstrapped = true;
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({
      google_ad_client: ADSENSE_CLIENT,
      enable_page_level_ads: true,
    });
  } catch {
    // ignore
  }
}

/**
 * Dedicated AdSense space. Always mounts a labeled layout slot so inventory
 * stays reserved site-wide; fills with a real unit once client + slot are set.
 *
 * Set `reserve` to keep an empty labeled frame before slot IDs are configured.
 */
const AdSenseUnit = ({
  placement,
  className,
  reserve = false,
  /** @deprecated use placement */
  slot,
}: {
  placement?: AdPlacement;
  className?: string;
  reserve?: boolean;
  /** Legacy alias — maps inarticle → tool-after-upload, sidebar → tool-after-seo */
  slot?: "inarticle" | "sidebar";
}) => {
  const resolved: AdPlacement =
    placement ??
    (slot === "sidebar" ? "tool-after-seo" : "tool-after-upload");

  const adRef = useRef<HTMLModElement>(null);
  const adSlot = slotForPlacement(resolved);
  const ready = adsenseEnabled() && Boolean(adSlot);

  useEffect(() => {
    if (!adsenseEnabled()) return;
    let cancelled = false;
    loadAdSense()
      .then(() => {
        if (cancelled) return;
        enableAutoAds();
        if (!ready || !adRef.current) return;
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch {
          // Ad blockers / duplicate pushes — ignore.
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready, adSlot]);

  if (!ready && !reserve) return null;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-2",
        className
      )}
      data-ad-placement={resolved}
      aria-label="Advertisement"
    >
      <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Advertisement
      </p>
      {ready ? (
        <ins
          ref={adRef}
          className="adsbygoogle"
          style={{ display: "block", minHeight: 90 }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={adSlot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        <div className="flex min-h-[90px] items-center justify-center rounded-lg bg-muted/40 px-3 text-center text-xs text-muted-foreground">
          Ad space reserved for Google AdSense
        </div>
      )}
    </div>
  );
};

export default AdSenseUnit;
