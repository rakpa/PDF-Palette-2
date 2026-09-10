import { ExternalLink } from "lucide-react";
import { getAffiliateSlots, type AffiliateOffer } from "@/lib/monetization";
import { cn } from "@/lib/utils";

const accentClass: Record<AffiliateOffer["accent"], string> = {
  orange: "border-tool-orange/50 bg-tool-orange/5",
  blue: "border-tool-blue/50 bg-tool-blue/5",
  green: "border-tool-green/50 bg-tool-green/5",
};

const accentText: Record<AffiliateOffer["accent"], string> = {
  orange: "text-tool-orange",
  blue: "text-tool-blue",
  green: "text-tool-green",
};

/**
 * Right-rail affiliate / partner banners on tool pages.
 * Always rendered (stacks under the tool on small screens).
 * Empty URLs keep a clear reserved ad unit until links are set in
 * affiliate-config or VITE_AFFILIATE_*_URL.
 */
const AffiliateSidebar = ({ className }: { className?: string }) => {
  const slots = getAffiliateSlots();
  if (slots.length === 0) return null;

  return (
    <aside
      className={cn("w-full space-y-4", className)}
      aria-label="Advertisement"
      data-affiliate-sidebar
    >
      <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Advertisement
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
              <span className="mt-3 flex min-h-[180px] flex-1 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-muted/50 px-3 text-center">
                <span className="text-xs font-medium text-muted-foreground">
                  Ad space reserved
                </span>
                <span className="text-[11px] text-muted-foreground/80">
                  {offer.name} · ~300×250
                </span>
              </span>
            )}
          </>
        );

        const shell = cn(
          "flex min-h-[240px] flex-col rounded-xl border p-4",
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
