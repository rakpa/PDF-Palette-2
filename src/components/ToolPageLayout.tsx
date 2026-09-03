import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
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
        {/* Header */}
        <section className="border-b border-border bg-gradient-to-br from-background to-muted/30 py-4 md:py-5">
          <div className="container mx-auto px-4">
            {/* Breadcrumb */}
            <motion.nav
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Link to="/" className="flex items-center gap-1 hover:text-foreground transition-colors">
                <Home className="h-4 w-4" />
                Home
              </Link>
              <ChevronRight className="h-4 w-4" />
              <span className="text-foreground">{tool.name}</span>
            </motion.nav>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto max-w-2xl text-center"
            >
              <div
                className={cn(
                  "mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl",
                  colorClasses[tool.color]
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold text-foreground md:text-2xl">
                {tool.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground md:text-base">
                {tool.description}
              </p>
            </motion.div>
          </div>
        </section>

        {/* Content */}
        <section className="py-4 md:py-6">
          <div className="container mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              {children}
            </motion.div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default ToolPageLayout;
