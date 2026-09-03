import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { PDFTool } from "@/lib/tools";
import Navbar from "./Navbar";
import Footer from "./Footer";
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />

      <main className="flex-1">
        <section className="border-b border-border bg-gradient-to-br from-background to-muted/30">
          <div className="container mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <nav className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link to="/" className="flex items-center gap-1 hover:text-foreground transition-colors">
                <Home className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only">Home</span>
              </Link>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground">{tool.name}</span>
            </nav>

            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  colorClasses[tool.color]
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold leading-tight text-foreground md:text-lg">
                  {tool.name}
                </h1>
                <p className="truncate text-xs text-muted-foreground md:text-sm">
                  {tool.description}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-3">
          <div className="container mx-auto px-4">
            {children}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default ToolPageLayout;
