import { lazy, Suspense } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import ToolsGrid from "@/components/ToolsGrid";
import Footer from "@/components/Footer";
import Features from "@/components/Features";
import MonetizationBlock from "@/components/MonetizationBlock";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, useSeo } from "@/lib/seo";

const HowItWorks = lazy(() => import("@/components/HowItWorks"));

const BelowFoldFallback = () => (
  <div className="h-24 animate-pulse bg-muted/20" aria-hidden />
);

const Index = () => {
  useSeo({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: "/" });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <ToolsGrid />
        <section className="container mx-auto px-4 py-8">
          <MonetizationBlock placement="home-below-tools" />
        </section>
        <Features />
        <Suspense fallback={<BelowFoldFallback />}>
          <HowItWorks />
        </Suspense>
        <section className="container mx-auto px-4 py-10">
          <MonetizationBlock
            placement="home-below-content"
            showAffiliate={false}
          />
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Index;
