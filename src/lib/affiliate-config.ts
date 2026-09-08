/**
 * Manual affiliate offers (Hostinger, Cloudways, …).
 * Paste your tracking links below — used until/alongside AdSense.
 * Env vars VITE_AFFILIATE_*_URL override these when set.
 */
export type ManualAffiliate = {
  id: string;
  name: string;
  tagline: string;
  cta: string;
  /** Full affiliate URL including your partner / ref ID. */
  url: string;
  accent: "orange" | "blue" | "green";
};

export const MANUAL_AFFILIATES: ManualAffiliate[] = [
  {
    id: "hostinger",
    name: "Hostinger",
    tagline: "Affordable web hosting with a free domain on selected plans.",
    cta: "See Hostinger deals",
    // Paste your Hostinger affiliate link here:
    url: "",
    accent: "orange",
  },
  {
    id: "cloudways",
    name: "Cloudways",
    tagline: "Managed cloud hosting on DigitalOcean, AWS, and Google Cloud.",
    cta: "Try Cloudways",
    // Paste your Cloudways affiliate link here:
    url: "",
    accent: "blue",
  },
];
