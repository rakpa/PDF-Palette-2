import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { PDFTool } from "@/lib/tools";
import { getToolContent, useSeo } from "@/lib/seo";
import Navbar from "./Navbar";
import Footer from "./Footer";
import ToolSeoContent from "./ToolSeoContent";
import MonetizationBlock from "./MonetizationBlock";
import { cn } from "@/lib/utils";

interface ToolPageLayoutProps {
  tool: PDFTool;
  children: ReactNode;
}

const colorClasses = {
  coral: "bg-tool-coral text-white",
  green: "bg-tool-green text-white",
  blue: "bg-tool-blue text-white",
  yellow: "bg-tool-yellow text-white",
  purple: "bg-tool-purple text-white",
  orange: "bg-tool-orange text-white",
  teal: "bg-tool-teal text-white",
  pink: "bg-tool-pink text-white",
};

const ToolPageLayout = ({ tool, children }: ToolPageLayoutProps) => {
  const Icon = tool.icon;
  const content = getToolContent(tool.route);

  useSeo({
    title: content?.title ?? `${tool.name} — Free Online Tool | PDF Palette`,
    description: content?.description ?? tool.description,
    path: tool.route,
  });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        <section className="border-b border-border bg-gradient-to-br from-background to-muted/30">
          <div className="container mx-auto px-4 py-3 md:py-4">
            <nav className="mb-4 flex items-center gap-1.5 text-lg text-muted-foreground md:mb-5">
              <Link to="/" className="flex items-center gap-1 hover:text-foreground transition-colors">
                <Home className="h-5 w-5" />
                Home
              </Link>
              <ChevronRight className="h-5 w-5" />
              <span className="text-foreground">{tool.name}</span>
            </nav>

            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  colorClasses[tool.color]
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">{tool.name}</p>
                <h1 className="mt-1 text-2xl font-bold leading-snug text-foreground">
                  {content?.h1 ?? tool.name}
                </h1>
                <p className="mt-1.5 text-lg text-muted-foreground">
                  {tool.description}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-5 md:py-6">
          <div className="container mx-auto px-4">
            {children}
            <MonetizationBlock
              placement="tool-after-upload"
              className="mx-auto mt-8 max-w-3xl"
            />
            {content && <ToolSeoContent tool={tool} content={content} />}
            <MonetizationBlock
              placement="tool-after-seo"
              className="mx-auto mt-10 max-w-3xl"
              showAffiliate={false}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default ToolPageLayout;
