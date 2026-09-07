import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronRight, Minus } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSeo } from "@/lib/seo";

type PlanId = "monthly" | "yearly";

const plans: Record<
  PlanId,
  { label: string; price: string; cadence: string; savings?: string; billed: string }
> = {
  monthly: {
    label: "Monthly",
    price: "$4.99",
    cadence: "/ month",
    billed: "Billed monthly. Cancel anytime.",
  },
  yearly: {
    label: "Yearly",
    price: "$29.99",
    cadence: "/ year",
    savings: "Save 50%",
    billed: "Billed yearly · $2.50 / month equivalent.",
  },
};

const included = [
  "Unlimited document processing",
  "No ads while you work",
  "Stronger OCR for scanned PDFs",
  "Every current PDF Palette tool",
  "Access to future paid tools",
  "Priority support",
];

const comparison: Array<{
  feature: string;
  free: string | boolean;
  premium: string | boolean;
}> = [
  { feature: "All core PDF tools", free: true, premium: true },
  { feature: "No account required for free tools", free: true, premium: true },
  { feature: "Unlimited processing", free: false, premium: true },
  { feature: "Ad-free experience", free: false, premium: true },
  { feature: "Stronger OCR conversion", free: "Standard", premium: "Enhanced" },
  { feature: "Future paid tools", free: false, premium: true },
  { feature: "Priority support", free: false, premium: true },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-tool-green/15 text-tool-green">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground/50">
        <Minus className="h-4 w-4" />
      </span>
    );
  }
  return <span className="text-sm font-medium text-foreground">{value}</span>;
}

const Premium = () => {
  const [plan, setPlan] = useState<PlanId>("yearly");
  const selected = plans[plan];

  useSeo({
    title: "Premium | PDF Palette",
    description:
      "PDF Palette Premium — unlimited processing, no ads, stronger OCR, and access to future paid tools. Monthly $4.99 or yearly $29.99. Stripe checkout coming soon.",
    path: "/premium",
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        {/* Hero + pricing */}
        <section className="relative border-b border-border">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                "linear-gradient(180deg, hsl(0 70% 55% / 0.06) 0%, transparent 42%), linear-gradient(90deg, transparent 60%, hsl(211 92% 48% / 0.04) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            aria-hidden
            style={{
              backgroundImage:
                "radial-gradient(hsl(var(--foreground) / 0.06) 0.6px, transparent 0.6px)",
              backgroundSize: "18px 18px",
              maskImage: "linear-gradient(180deg, black 0%, transparent 70%)",
            }}
          />

          <div className="container relative mx-auto px-4 pb-16 pt-8 md:pb-20 md:pt-10">
            <nav
              className="mb-10 flex items-center gap-1 text-sm text-muted-foreground"
              aria-label="Breadcrumb"
            >
              <Link to="/" className="transition-colors hover:text-foreground">
                Home
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="text-foreground">Premium</span>
            </nav>

            <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
              <div>
                <motion.p
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm font-medium text-primary"
                >
                  Premium
                </motion.p>
                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 }}
                  className="mt-3 max-w-xl text-4xl font-bold tracking-tight text-foreground md:text-5xl md:leading-[1.1]"
                >
                  More capacity.
                  <br />
                  Same PDF Palette.
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                  className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg"
                >
                  Free tools stay free. Premium removes limits, turns off ads, improves OCR on
                  scans, and includes every paid tool we add later.
                </motion.p>

                <motion.ul
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 }}
                  className="mt-8 grid gap-3 sm:grid-cols-2"
                >
                  {included.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      {item}
                    </li>
                  ))}
                </motion.ul>
              </div>

              <motion.aside
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-7"
              >
                <div
                  className="grid grid-cols-2 rounded-xl bg-muted p-1"
                  role="tablist"
                  aria-label="Billing period"
                >
                  {(["monthly", "yearly"] as PlanId[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={plan === id}
                      onClick={() => setPlan(id)}
                      className={cn(
                        "relative rounded-lg px-3 py-2.5 text-sm font-medium transition",
                        plan === id
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {plans[id].label}
                      {id === "yearly" && (
                        <span className="ml-1.5 text-xs font-semibold text-tool-green">-50%</span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="mt-8">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={plan}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                    >
                      <div className="flex items-end gap-2">
                        <span className="text-5xl font-bold tracking-tight text-foreground">
                          {selected.price}
                        </span>
                        <span className="mb-1.5 text-base text-muted-foreground">
                          {selected.cadence}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{selected.billed}</p>
                      {selected.savings && (
                        <p className="mt-2 inline-flex rounded-md bg-tool-green/10 px-2 py-1 text-xs font-semibold text-tool-green">
                          {selected.savings} vs monthly
                        </p>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>

                <Button size="lg" className="mt-8 h-12 w-full text-base" disabled>
                  Checkout with Stripe — coming soon
                </Button>
                <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">
                  Secure payments via Stripe. No card details on this page yet.
                </p>

                <div className="mt-6 border-t border-border pt-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Also includes
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-foreground">
                    {["Cancel anytime once billing ships", "No document storage account"].map(
                      (line) => (
                        <li key={line} className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} />
                          {line}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              </motion.aside>
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="container mx-auto px-4 py-16 md:py-20">
          <div className="mx-auto max-w-4xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Free vs Premium
              </h2>
              <p className="mt-2 text-muted-foreground">
                Start free. Upgrade when you need unlimited runs and upcoming paid tools.
              </p>
            </div>

            <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] border-b border-border bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground md:px-6">
                <span>Feature</span>
                <span className="text-center">Free</span>
                <span className="text-center text-primary">Premium</span>
              </div>
              {comparison.map((row, index) => (
                <div
                  key={row.feature}
                  className={cn(
                    "grid grid-cols-[1.4fr_0.8fr_0.8fr] items-center px-4 py-3.5 md:px-6",
                    index !== comparison.length - 1 && "border-b border-border"
                  )}
                >
                  <span className="pr-3 text-sm text-foreground">{row.feature}</span>
                  <div className="flex justify-center">
                    <Cell value={row.free} />
                  </div>
                  <div className="flex justify-center">
                    <Cell value={row.premium} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl border border-border bg-foreground px-6 py-6 text-background md:flex-row md:items-center md:px-8">
              <div>
                <p className="text-lg font-semibold">Ready when Stripe is connected</p>
                <p className="mt-1 text-sm text-background/70">
                  {selected.label} plan at {selected.price}
                  {selected.cadence}. Free tools remain available either way.
                </p>
              </div>
              <Button
                size="lg"
                variant="secondary"
                className="w-full shrink-0 bg-background text-foreground hover:bg-background/90 md:w-auto"
                disabled
              >
                Coming soon
              </Button>
            </div>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Questions?{" "}
              <Link to="/contact" className="text-primary underline-offset-4 hover:underline">
                Contact
              </Link>
              {" · "}
              <Link to="/terms" className="text-primary underline-offset-4 hover:underline">
                Terms
              </Link>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Premium;
