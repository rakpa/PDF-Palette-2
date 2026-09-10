/**
 * Monetization — manual affiliates + dedicated AdSense placements.
 *
 * Affiliates: edit src/lib/affiliate-config.ts (or set VITE_AFFILIATE_*_URL).
 * AdSense: set VITE_ADSENSE_CLIENT + per-placement slot IDs after approval.
 */
import { MANUAL_AFFILIATES, type ManualAffiliate } from "./affiliate-config";

export type AffiliateOffer = ManualAffiliate;

const env = import.meta.env;

export const ADSENSE_CLIENT = String(env.VITE_ADSENSE_CLIENT || "").trim();

/** When true, also load AdSense Auto ads (Google may place extra units). */
export const ADSENSE_AUTO = String(env.VITE_ADSENSE_AUTO || "").trim() === "true";

/**
 * Named layout slots reserved across the site.
 * Create matching ad units in AdSense and paste slot IDs into env.
 */
export const AD_PLACEMENTS = {
  homeBelowTools: "home-below-tools",
  homeBelowContent: "home-below-content",
  toolAfterUpload: "tool-after-upload",
  toolAfterSeo: "tool-after-seo",
  siteFooter: "site-footer",
} as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[keyof typeof AD_PLACEMENTS];

const placementEnv: Record<AdPlacement, string> = {
  "home-below-tools": String(env.VITE_ADSENSE_SLOT_HOME_BELOW_TOOLS || "").trim(),
  "home-below-content": String(
    env.VITE_ADSENSE_SLOT_HOME_BELOW_CONTENT || env.VITE_ADSENSE_SLOT_INARTICLE || ""
  ).trim(),
  "tool-after-upload": String(
    env.VITE_ADSENSE_SLOT_TOOL_AFTER_UPLOAD || env.VITE_ADSENSE_SLOT_INARTICLE || ""
  ).trim(),
  "tool-after-seo": String(
    env.VITE_ADSENSE_SLOT_TOOL_AFTER_SEO || env.VITE_ADSENSE_SLOT_SIDEBAR || ""
  ).trim(),
  "site-footer": String(env.VITE_ADSENSE_SLOT_FOOTER || "").trim(),
};

export function adsenseEnabled(): boolean {
  return Boolean(ADSENSE_CLIENT);
}

export function slotForPlacement(placement: AdPlacement): string {
  return placementEnv[placement] || "";
}

/** Env overrides win; otherwise use affiliate-config.ts URLs. */
export function getAffiliateOffers(): AffiliateOffer[] {
  const hostingerEnv = String(env.VITE_AFFILIATE_HOSTINGER_URL || "").trim();
  const cloudwaysEnv = String(env.VITE_AFFILIATE_CLOUDWAYS_URL || "").trim();

  return MANUAL_AFFILIATES.map((offer) => {
    let url = offer.url.trim();
    if (offer.id === "hostinger" && hostingerEnv) url = hostingerEnv;
    if (offer.id === "cloudways" && cloudwaysEnv) url = cloudwaysEnv;
    return { ...offer, url };
  }).filter((offer) => Boolean(offer.url));
}
