import AffiliateOffers from "./AffiliateOffers";
import AdSenseUnit from "./AdSenseUnit";
import type { AdPlacement } from "@/lib/monetization";
import { cn } from "@/lib/utils";

/**
 * Manual affiliates (Hostinger / Cloudways) + a dedicated AdSense space.
 * Same pattern used on tool pages — reuse on home and other content pages.
 */
const MonetizationBlock = ({
  placement,
  className,
  showAffiliate = true,
  /** Dedicated AdSense frame stays in the layout even before slot IDs are set. */
  reserveAd = true,
}: {
  placement: AdPlacement;
  className?: string;
  showAffiliate?: boolean;
  /** Keep an empty labeled AdSense frame until IDs are configured. */
  reserveAd?: boolean;
}) => (
  <div className={cn("space-y-6", className)}>
    {showAffiliate && <AffiliateOffers />}
    <AdSenseUnit placement={placement} reserve={reserveAd} />
  </div>
);

export default MonetizationBlock;
