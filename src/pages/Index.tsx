import { lazy, Suspense } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import ToolsGrid from "@/components/ToolsGrid";
import Footer from "@/components/Footer";

const Features = lazy(() => import("@/components/Features"));
const HowItWorks = lazy(() => import("@/components/HowItWorks"));

const BelowFoldFallback = () => (
  <div className="h-24 animate-pulse bg-muted/20" aria-hidden />
);

const Index = () => {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <ToolsGrid />
        <Suspense fallback={<BelowFoldFallback />}>
          <Features />
        </Suspense>
        <Suspense fallback={<BelowFoldFallback />}>
          <HowItWorks />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
};

export default Index;
