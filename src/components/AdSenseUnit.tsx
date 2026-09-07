import { useEffect, useRef } from "react";
import {
  ADSENSE_CLIENT,
  ADSENSE_SLOT_INARTICLE,
  ADSENSE_SLOT_SIDEBAR,
  adsenseEnabled,
} from "@/lib/monetization";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type Slot = "inarticle" | "sidebar";

const slotId: Record<Slot, string> = {
  inarticle: ADSENSE_SLOT_INARTICLE,
  sidebar: ADSENSE_SLOT_SIDEBAR,
};

let scriptLoading: Promise<void> | null = null;

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

/**
 * Google AdSense unit. Renders nothing until client + slot IDs are configured.
 * Apply for AdSense first; then set VITE_ADSENSE_CLIENT and slot env vars.
 */
const AdSenseUnit = ({
  slot = "inarticle",
  className,
}: {
  slot?: Slot;
  className?: string;
}) => {
  const adRef = useRef<HTMLModElement>(null);
  const adSlot = slotId[slot];
  const ready = adsenseEnabled() && Boolean(adSlot);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loadAdSense()
      .then(() => {
        if (cancelled || !adRef.current) return;
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

  if (!ready) return null;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-2", className)}>
      <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">Advertisement</p>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={adSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
};

export default AdSenseUnit;
