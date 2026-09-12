import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { DEFAULT_DESCRIPTION, useSeo } from "@/lib/seo";

interface LegalPageProps {
  title: string;
  description?: string;
  updated?: string;
  children: ReactNode;
}

const LegalPage = ({ title, description, updated, children }: LegalPageProps) => {
  useSeo({
    title: `${title} | PDF Palette`,
    description: description ?? DEFAULT_DESCRIPTION,
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 py-10 md:py-16 max-w-3xl">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-8" aria-label="Breadcrumb">
          <Link to="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <ChevronRight className="h-4 w-4 shrink-0" />
          <span className="text-foreground">{title}</span>
        </nav>
        <header className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-zinc-800 dark:text-foreground tracking-tight">{title}</h1>
          {updated && (
            <p className="mt-2 text-sm text-zinc-800 dark:text-foreground">Last updated: {updated}</p>
          )}
          {description && (
            <p className="mt-3 text-base font-normal text-zinc-800 dark:text-foreground leading-relaxed">{description}</p>
          )}
        </header>
        <article className="space-y-8 text-zinc-800 dark:text-foreground leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-zinc-800 dark:[&_h2]:text-foreground [&_h2]:mt-2 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline">
          {children}
        </article>
      </main>
      <Footer />
    </div>
  );
};

export default LegalPage;
