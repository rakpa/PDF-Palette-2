/**
 * Monetization config — affiliate links and AdSense.
 * Leave values empty until you have real IDs; empty slots render nothing.
 */
export type AffiliateOffer = {
  id: string;
  name: string;
  tagline: string;
  cta: string;
  /** Full affiliate URL including your partner ID. */
  url: string;
  accent: "orange" | "blue" | "green";
};

const env = import.meta.env;

export const ADSENSE_CLIENT = String(env.VITE_ADSENSE_CLIENT || "").trim();
export const ADSENSE_SLOT_INARTICLE = String(env.VITE_ADSENSE_SLOT_INARTICLE || "").trim();
export const ADSENSE_SLOT_SIDEBAR = String(env.VITE_ADSENSE_SLOT_SIDEBAR || "").trim();

export function adsenseEnabled(): boolean {
  return Boolean(ADSENSE_CLIENT);
}

/** Hostinger / Cloudways (and more later). Only shown when URL is set. */
export function getAffiliateOffers(): AffiliateOffer[] {
  const offers: AffiliateOffer[] = [];
  const hostinger = String(env.VITE_AFFILIATE_HOSTINGER_URL || "").trim();
  const cloudways = String(env.VITE_AFFILIATE_CLOUDWAYS_URL || "").trim();

  if (hostinger) {
    offers.push({
      id: "hostinger",
      name: "Hostinger",
      tagline: "Affordable web hosting with a free domain on selected plans.",
      cta: "See Hostinger deals",
      url: hostinger,
      accent: "orange",
    });
  }
  if (cloudways) {
    offers.push({
      id: "cloudways",
      name: "Cloudways",
      tagline: "Managed cloud hosting on DigitalOcean, AWS, and Google Cloud.",
      cta: "Try Cloudways",
      url: cloudways,
      accent: "blue",
    });
  }
  return offers;
}
