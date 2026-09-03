import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, ChevronDown, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pdfTools } from "@/lib/tools";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion, AnimatePresence } from "framer-motion";
import ThemeToggle from "./ThemeToggle";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  const convertTools = pdfTools.filter(
    (t) => t.category.includes("convert-to") || t.category.includes("convert-from")
  );
  const allTools = pdfTools.slice(0, 8);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <FileText className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">PDF Palette</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-1 md:flex">
            <Link to="/pdf-to-word">
              <Button variant="ghost" size="sm">
                PDF to Word
              </Button>
            </Link>
            <Link to="/word-to-pdf">
              <Button variant="ghost" size="sm">
                Word to PDF
              </Button>
            </Link>
            <Link to="/compress-pdf">
              <Button variant="ghost" size="sm">
                Compress PDF
              </Button>
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1">
                  Convert PDF
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48">
                {convertTools.map((tool) => (
                  <DropdownMenuItem key={tool.id} asChild>
                    <Link to={tool.route} className="flex items-center gap-2">
                      <tool.icon className="h-4 w-4" />
                      {tool.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1">
                  All PDF Tools
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48">
                {allTools.map((tool) => (
                  <DropdownMenuItem key={tool.id} asChild>
                    <Link to={tool.route} className="flex items-center gap-2">
                      <tool.icon className="h-4 w-4" />
                      {tool.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem asChild>
                  <Link to="/#tools" className="font-medium text-primary">
                    View all tools →
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Right side */}
          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <Link to="/#tools">
              <Button size="sm">Explore tools</Button>
            </Link>
          </div>

          {/* Mobile controls */}
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Toggle menu"
            >
              {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border md:hidden"
          >
            <div className="container mx-auto space-y-2 px-4 py-4">
              <Link
                to="/pdf-to-word"
                className="block rounded-lg px-3 py-2 hover:bg-muted"
                onClick={() => setIsOpen(false)}
              >
                PDF to Word
              </Link>
              <Link
                to="/word-to-pdf"
                className="block rounded-lg px-3 py-2 hover:bg-muted"
                onClick={() => setIsOpen(false)}
              >
                Word to PDF
              </Link>
              <Link
                to="/compress-pdf"
                className="block rounded-lg px-3 py-2 hover:bg-muted"
                onClick={() => setIsOpen(false)}
              >
                Compress PDF
              </Link>
              <Link
                to="/#tools"
                className="block rounded-lg px-3 py-2 font-medium text-primary hover:bg-muted"
                onClick={() => setIsOpen(false)}
              >
                All PDF Tools
              </Link>
              <Link to="/#tools" onClick={() => setIsOpen(false)}>
                <Button size="sm" className="mt-2 w-full">
                  Explore tools
                </Button>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
