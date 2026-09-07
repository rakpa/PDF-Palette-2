import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Check,
  ChevronRight,
  FileText,
  Infinity,
  Sparkles,
  Headphones,
  Ban,
  ScanText,
  Rocket,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSeo } from "@/lib/seo";

type PlanId = "monthly" | "yearly";

const plans: Array<{
  id: PlanId;
  label: string;
  price: string;
  period: string;
  note: string;
  badge?: string;
}> = [
  {
    id: "monthly",
    label: "Monthly",
    price: "$4.99",
    period: "per month",
    note: "Cancel anytime",
  },
  {
    id: "yearly",
    label: "Yearly",
    price: "$29.99",
    period: "per year",
    note: "About $2.50 / month",
    badge: "Best value",
  },
];

const benefits = [
  {
    icon: Infinity,
    title: "Unlimited document processing",
    description: "Convert, compress, merge, and edit without hitting free-tier caps.",
  },
  {
    icon: Ban,
    title: "No ads",
    description: "A quieter workspace while you work through documents.",
  },
  {
    icon: ScanText,
    title: "Stronger OCR conversion",
    description: "Better handling of scanned PDFs when you need searchable or editable output.",
  },
  {
    icon: Sparkles,
    title: "Full access to every PDF Palette tool",
    description: "PDF ↔ Word, Office convert, redact, sign, organize, and the rest of the toolkit.",
  },
  {
    icon: Rocket,
    title: "Access to future paid tools",
    description: "New premium features we ship later are included in your plan.",
  },
  {
    icon: Headphones,
    title: "Priority support",
    description: "Faster help when a conversion or workflow needs a second look.",
  },
];

const Premium = () => {
  const [plan, setPlan] = useState<PlanId>("yearly");
  const selected = plans.find((p) => p.id === plan)!;

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
        <section className="relative overflow-hidden border-b border-border">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 10% -10%, hsl(0 70% 55% / 0.12), transparent 55%), radial-gradient(ellipse 60% 50% at 90% 0%, hsl(211 92% 48% / 0.08), transparent 50%)",
            }}
          />
          <div className="container relative mx-auto px-4 py-12 md:py-16">
            <nav
              className="mb-8 flex items-center gap-1 text-sm text-muted-foreground"
              aria-label="Breadcrumb"
            >
              <Link to="/" className="transition-colors hover:text-foreground">
                Home
              </Link>
              <ChevronRight className="h-4 w-4 shrink-0" />
              <span className="text-foreground">Premium</span>
            </nav>

            <div className="mx-auto max-w-3xl text-center">
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary"
              >
                PDF Palette Premium
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="text-3xl font-bold tracking-tight text-foreground md:text-5xl"
              >
                Keep the free tools. Unlock the full runway.
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg"
              >
                Everyday conversions stay free. Premium is for unlimited work, no ads, stronger OCR,
                and access to future paid tools — when you need the toolkit without friction.
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2"
            >
              {plans.map((option) => {
                const active = plan === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPlan(option.id)}
                    className={cn(
                      "relative rounded-2xl border px-5 py-5 text-left transition",
                      active
                        ? "border-primary bg-card shadow-[0_0_0_1px_hsl(var(--primary))]"
                        : "border-border bg-card/70 hover:border-primary/40"
                    )}
                  >
                    {option.badge && (
                      <span className="absolute right-4 top-4 rounded-md bg-tool-green/15 px-2 py-0.5 text-xs font-semibold text-tool-green">
                        {option.badge}
                      </span>
                    )}
                    <p className="text-sm font-medium text-muted-foreground">{option.label}</p>
                    <p className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-foreground">{option.price}</span>
                      <span className="text-sm text-muted-foreground">{option.period}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{option.note}</p>
                  </button>
                );
              })}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mx-auto mt-6 max-w-3xl rounded-2xl border border-border bg-card p-6 md:p-8"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Selected plan</p>
                  <p className="text-xl font-semibold text-foreground">
                    {selected.label} · {selected.price}
                  </p>
                </div>
                <Button size="lg" className="w-full sm:w-auto" disabled>
                  Checkout with Stripe — coming soon
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Payments will run through Stripe. No card details are collected on this page yet.
              </p>
            </motion.div>
          </div>
        </section>

        <section className="container mx-auto px-4 py-14 md:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-foreground md:text-3xl">What Premium includes</h2>
            <p className="mt-2 text-muted-foreground">
              Inspired by what paid PDF suites usually unlock — adapted for PDF Palette.
            </p>

            <ul className="mt-8 space-y-4">
              {benefits.map(({ icon: Icon, title, description }) => (
                <li
                  key={title}
                  className="flex gap-4 rounded-xl border border-border/80 bg-card/50 px-4 py-4 md:px-5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">{title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-10 rounded-2xl border border-dashed border-border bg-muted/30 p-6">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="font-semibold text-foreground">Free tools stay free</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Merge, split, compress, convert, OCR, edit, and the rest remain available without an
                    account. Premium is optional when you want unlimited runs, a quieter UI, and early
                    access to tools we introduce later.
                  </p>
                </div>
              </div>
              <ul className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                {[
                  "Cancel anytime once billing ships",
                  "Includes future paid tools",
                  "No document storage account",
                  "Stripe checkout (coming soon)",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-tool-green" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Questions? See{" "}
              <Link to="/contact" className="text-primary underline-offset-4 hover:underline">
                Contact
              </Link>{" "}
              or our{" "}
              <Link to="/terms" className="text-primary underline-offset-4 hover:underline">
                Terms
              </Link>
              .
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Premium;
