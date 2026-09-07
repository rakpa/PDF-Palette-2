import { ExternalLink } from "lucide-react";
import { getAffiliateOffers, type AffiliateOffer } from "@/lib/monetization";
import { cn } from "@/lib/utils";

const accentClass: Record<AffiliateOffer["accent"], string> = {
  orange: "border-tool-orange/30 bg-tool-orange/5",
  blue: "border-tool-blue/30 bg-tool-blue/5",
  green: "border-tool-green/30 bg-tool-green/5",
};

const accentText: Record<AffiliateOffer["accent"], string> = {
  orange: "text-tool-orange",
  blue: "text-tool-blue",
  green: "text-tool-green",
};

/**
 * Affiliate partner cards. Hidden until VITE_AFFILIATE_*_URL env vars are set.
 */
const AffiliateOffers = ({ className }: { className?: string }) => {
  const offers = getAffiliateOffers();
  if (offers.length === 0) return null;

  return (
    <aside
      className={cn("rounded-2xl border border-border bg-card p-5 md:p-6", className)}
      aria-label="Partner offers"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Partner offers
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        We may earn a commission if you buy through these links — at no extra cost to you.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {offers.map((offer) => (
          <li key={offer.id}>
            <a
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className={cn(
                "flex h-full flex-col rounded-xl border p-4 transition hover:shadow-sm",
                accentClass[offer.accent]
              )}
            >
              <span className={cn("text-sm font-semibold", accentText[offer.accent])}>
                {offer.name}
              </span>
              <span className="mt-1 flex-1 text-sm text-muted-foreground">{offer.tagline}</span>
              <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                {offer.cta}
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
};

export default AffiliateOffers;
