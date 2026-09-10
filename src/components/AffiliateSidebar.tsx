import { ExternalLink } from "lucide-react";
import { getAffiliateSlots, type AffiliateOffer } from "@/lib/monetization";
import { cn } from "@/lib/utils";

const accentClass: Record<AffiliateOffer["accent"], string> = {
  orange: "border-tool-orange/40 bg-tool-orange/5",
  blue: "border-tool-blue/40 bg-tool-blue/5",
  green: "border-tool-green/40 bg-tool-green/5",
};

const accentText: Record<AffiliateOffer["accent"], string> = {
  orange: "text-tool-orange",
  blue: "text-tool-blue",
  green: "text-tool-green",
};

/**
 * Right-rail affiliate banners on tool pages.
 * Slots stay visible so Hostinger (etc.) links can be dropped in later —
 * paste URLs in src/lib/affiliate-config.ts or VITE_AFFILIATE_*_URL.
 */
const AffiliateSidebar = ({ className }: { className?: string }) => {
  const slots = getAffiliateSlots();

  if (slots.length === 0) return null;

  return (
    <aside
      className={cn("hidden w-full space-y-4 lg:block", className)}
      aria-label="Partner offers"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Partner offers
      </p>
      {slots.map((offer) => {
        const live = Boolean(offer.url.trim());
        const body = (
          <>
            <span className={cn("text-sm font-semibold", accentText[offer.accent])}>
              {offer.name}
            </span>
            {live ? (
              <>
                <span className="mt-2 flex-1 text-sm leading-snug text-muted-foreground">
                  {offer.tagline}
                </span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {offer.cta}
                  <ExternalLink className="h-3.5 w-3.5" />
                </span>
              </>
            ) : (
              <span className="mt-3 flex min-h-[160px] flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/60 bg-muted/40 px-3 text-center">
                <span className="text-xs font-medium text-muted-foreground">
                  Affiliate space reserved
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  for {offer.name} · ~300×250
                </span>
              </span>
            )}
          </>
        );

        const shell = cn(
          "flex min-h-[220px] flex-col rounded-xl border p-4",
          accentClass[offer.accent],
          live && "transition hover:shadow-sm"
        );

        return live ? (
          <a
            key={offer.id}
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className={shell}
            data-affiliate-slot={offer.id}
          >
            {body}
          </a>
        ) : (
          <div key={offer.id} className={shell} data-affiliate-slot={offer.id}>
            {body}
          </div>
        );
      })}
    </aside>
  );
};

export default AffiliateSidebar;
