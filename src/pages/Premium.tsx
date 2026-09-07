import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSeo } from "@/lib/seo";
import { categories, getToolsByCategory, type ToolCategory } from "@/lib/tools";

type PlanId = "monthly" | "yearly";

const billing = {
  monthly: {
    price: "$4.99",
    unit: "/ month",
    detail: "Billed monthly. Cancel anytime.",
  },
  yearly: {
    price: "$29.99",
    unit: "/ year",
    detail: "Billed yearly · about $2.50 / month",
    badge: "Save 50%",
  },
} as const;

const premiumExtras = [
  "Unlimited use of every tool",
  "No ads",
  "Stronger OCR for scanned PDFs",
  "Premium-only tools (Fill, Redact, Compare)",
  "Access to future paid tools",
  "Priority support",
];

const freeExtras = [
  "27 core PDF tools with limits",
  "No account required",
  "Most tools run in your browser",
];

const planDiff: Array<{
  feature: string;
  free: string | boolean;
  premium: string | boolean;
}> = [
  { feature: "Document processing", free: "Standard", premium: "Unlimited" },
  { feature: "Ads", free: "May show", premium: "None" },
  { feature: "OCR for scanned PDFs", free: "Standard", premium: "Enhanced" },
  { feature: "Future paid tools", free: false, premium: true },
  { feature: "Priority support", free: false, premium: true },
];

const toolGroups = categories.filter((c) => c.id !== "all") as Array<{
  id: Exclude<ToolCategory, "all">;
  label: string;
}>;

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
      <span className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground/45">
        <Minus className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "text-sm font-medium",
        value === "Limited" || value === "May show" || value === "Standard"
          ? "text-muted-foreground"
          : "text-foreground"
      )}
    >
      {value}
    </span>
  );
}

/** Tools kept Premium-only in the comparison (advanced / newer capabilities). */
const premiumOnlyToolIds = new Set(["fill-forms", "redact", "compare"]);

function toolAccess(toolId: string): { free: string | boolean; premium: boolean } {
  if (premiumOnlyToolIds.has(toolId)) {
    return { free: false, premium: true };
  }
  return { free: "Limited", premium: true };
}

const Premium = () => {
  const [plan, setPlan] = useState<PlanId>("yearly");
  const [toolsOpen, setToolsOpen] = useState(true);
  const selected = billing[plan];

  const groupedTools = useMemo(() => {
    const seen = new Set<string>();
    return toolGroups
      .map((group) => ({
        ...group,
        tools: getToolsByCategory(group.id).filter((tool) => {
          if (seen.has(tool.id)) return false;
          // Prefer the tool's first declared category so each tool appears once.
          if (tool.category[0] !== group.id) return false;
          seen.add(tool.id);
          return true;
        }),
      }))
      .filter((group) => group.tools.length > 0);
  }, []);

  const toolCount = useMemo(
    () => new Set(groupedTools.flatMap((g) => g.tools.map((t) => t.id))).size,
    [groupedTools]
  );

  useSeo({
    title: "Pricing | PDF Palette",
    description:
      "PDF Palette pricing — Free tools forever, or Premium at $4.99/month or $29.99/year for unlimited processing, no ads, stronger OCR, and future paid tools. Stripe checkout coming soon.",
    path: "/premium",
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <section className="border-b border-border bg-card">
          <div className="container mx-auto px-4 pb-14 pt-8 md:pb-20 md:pt-12">
            <nav
              className="mb-8 flex items-center gap-1 text-sm text-muted-foreground"
              aria-label="Breadcrumb"
            >
              <Link to="/" className="transition-colors hover:text-foreground">
                Home
              </Link>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
              <span className="text-foreground">Pricing</span>
            </nav>

            <div className="mx-auto max-w-3xl text-center">
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-3xl font-bold tracking-tight text-foreground md:text-5xl"
              >
                Simple pricing for every workflow
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg"
              >
                Start free with all {toolCount} tools. Upgrade to Premium for unlimited processing,
                no ads, stronger OCR, and access to future paid tools.
              </motion.p>
            </div>

            {/* Billing toggle — Smallpdf-style centered control */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="mx-auto mt-8 flex justify-center"
            >
              <div
                className="inline-grid grid-cols-2 rounded-full border border-border bg-muted/70 p-1"
                role="tablist"
                aria-label="Billing period"
              >
                {(["yearly", "monthly"] as PlanId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={plan === id}
                    onClick={() => setPlan(id)}
                    className={cn(
                      "rounded-full px-5 py-2 text-sm font-medium transition",
                      plan === id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {id === "yearly" ? "Yearly" : "Monthly"}
                    {id === "yearly" && (
                      <span className="ml-2 text-xs font-semibold text-tool-green">-50%</span>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Plan cards */}
            <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-2">
              {/* Free */}
              <motion.article
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col rounded-2xl border border-border bg-background p-7 md:p-8"
              >
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Free
                </p>
                <div className="mt-4 flex items-end gap-1">
                  <span className="text-5xl font-bold tracking-tight text-foreground">$0</span>
                  <span className="mb-1.5 text-muted-foreground">forever</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  All core tools, no sign-up required.
                </p>
                <Button asChild size="lg" variant="outline" className="mt-7 h-12 w-full text-base">
                  <Link to="/#tools">Get started</Link>
                </Button>

                <div className="mt-8 border-t border-border pt-6">
                  <p className="text-sm font-semibold text-foreground">You get:</p>
                  <ul className="mt-4 space-y-3">
                    {freeExtras.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-tool-green" strokeWidth={3} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.article>

              {/* Premium */}
              <motion.article
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.14 }}
                className="relative flex flex-col rounded-2xl border-2 border-primary bg-background p-7 shadow-[0_20px_50px_-28px_hsl(0_70%_55%_/_0.55)] md:p-8"
              >
                <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Recommended
                </span>
                <p className="text-sm font-semibold uppercase tracking-wide text-primary">Premium</p>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={plan}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16 }}
                    className="mt-4"
                  >
                    <div className="flex items-end gap-1">
                      <span className="text-5xl font-bold tracking-tight text-foreground">
                        {selected.price}
                      </span>
                      <span className="mb-1.5 text-muted-foreground">{selected.unit}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{selected.detail}</p>
                    {"badge" in selected && selected.badge && (
                      <p className="mt-2 inline-flex rounded-md bg-tool-green/10 px-2 py-1 text-xs font-semibold text-tool-green">
                        {selected.badge} vs monthly
                      </p>
                    )}
                  </motion.div>
                </AnimatePresence>

                <Button
                  size="lg"
                  className="mt-7 h-12 w-full text-base disabled:opacity-100 disabled:bg-primary"
                  disabled
                >
                  Checkout with Stripe — coming soon
                </Button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Secure Stripe checkout will appear here.
                </p>

                <div className="mt-8 border-t border-border pt-6">
                  <p className="text-sm font-semibold text-foreground">Everything in Free, plus:</p>
                  <ul className="mt-4 space-y-3">
                    {premiumExtras.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={3} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.article>
            </div>
          </div>
        </section>

        {/* Detailed comparison */}
        <section className="container mx-auto px-4 py-16 md:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Compare plans in detail
              </h2>
              <p className="mt-2 text-muted-foreground">
                See what is included on Free and Premium — including every core tool.
              </p>
            </div>

            <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] border-b border-border bg-muted/50 px-4 py-3 text-sm font-semibold text-foreground md:px-6">
                <span>Feature</span>
                <span className="text-center">Free</span>
                <span className="text-center text-primary">Premium</span>
              </div>

              {planDiff.map((row, index) => (
                <div
                  key={row.feature}
                  className={cn(
                    "grid grid-cols-[1.5fr_0.75fr_0.75fr] items-center px-4 py-3.5 md:px-6",
                    "border-b border-border"
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

              {/* Expandable tools block */}
              <button
                type="button"
                onClick={() => setToolsOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-4 text-left md:px-6"
                aria-expanded={toolsOpen}
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    All {toolCount} core PDF tools
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Free is limited · Premium is unlimited · some tools are Premium-only
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 shrink-0 text-muted-foreground transition-transform",
                    toolsOpen && "rotate-180"
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {toolsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    {groupedTools.map((group) => (
                      <div key={group.id}>
                        <div className="border-b border-border bg-muted/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:px-6">
                          {group.label}
                        </div>
                        {group.tools.map((tool) => {
                          const access = toolAccess(tool.id);
                          return (
                          <div
                            key={`${group.id}-${tool.id}`}
                            className="grid grid-cols-[1.5fr_0.75fr_0.75fr] items-center border-b border-border px-4 py-3 md:px-6"
                          >
                            <span className="flex items-center gap-2 pr-3 text-sm text-foreground">
                              <tool.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {tool.name}
                              {premiumOnlyToolIds.has(tool.id) && (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                  Premium
                                </span>
                              )}
                            </span>
                            <div className="flex justify-center">
                              <Cell value={access.free} />
                            </div>
                            <div className="flex justify-center">
                              <Cell value={access.premium} />
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* FAQs — Smallpdf-style */}
            <div className="mx-auto mt-16 max-w-3xl">
              <h2 className="text-center text-2xl font-bold text-foreground">FAQs</h2>
              <dl className="mt-8 space-y-6">
                {[
                  {
                    q: "Do free tools stay free?",
                    a: "Yes. All current core tools remain available without an account. Premium is optional when you want unlimited processing, no ads, stronger OCR, and future paid tools.",
                  },
                  {
                    q: "How will I pay?",
                    a: "Checkout will run through Stripe. Card details are not collected on this page yet — the payment button will activate once Stripe is connected.",
                  },
                  {
                    q: "If I subscribe, do I get future paid tools?",
                    a: "Yes. Premium includes access to paid tools and features we ship later, for as long as your subscription is active.",
                  },
                  {
                    q: "Can I cancel?",
                    a: "Yes. Once billing ships, you can cancel anytime. Your plan stays active through the paid period.",
                  },
                ].map((item) => (
                  <div key={item.q} className="border-b border-border pb-6">
                    <dt className="text-base font-semibold text-foreground">{item.q}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <p className="mt-10 text-center text-sm text-muted-foreground">
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
