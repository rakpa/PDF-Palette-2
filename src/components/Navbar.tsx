import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { categories, getToolsByCategory } from "@/lib/tools";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { motion, AnimatePresence } from "framer-motion";
import ThemeToggle from "./ThemeToggle";

/** All real categories, excluding the "all" pseudo-category used by the homepage filter. */
const toolCategories = categories.filter((category) => category.id !== "all");

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

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

            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="h-10 bg-transparent text-sm font-medium">
                    All Tools
                  </NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="grid w-[720px] grid-cols-3 gap-x-6 gap-y-5 p-5">
                      {toolCategories.map((category) => (
                        <div key={category.id}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {category.label}
                          </p>
                          <ul className="space-y-1">
                            {getToolsByCategory(category.id).map((tool) => (
                              <li key={tool.id}>
                                <Link
                                  to={tool.route}
                                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/90 transition-colors hover:bg-accent hover:text-accent-foreground"
                                >
                                  <tool.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  {tool.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-border p-3">
                      <Link
                        to="/#tools"
                        className="block rounded-md px-2 py-1.5 text-center text-sm font-medium text-primary hover:bg-accent"
                      >
                        Browse all 27 tools →
                      </Link>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* Right side */}
          <div className="hidden items-center gap-2 md:flex">
            <ThemeToggle />
            <Link to="/premium">
              <Button variant="outline" size="sm">
                Premium
              </Button>
            </Link>
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
            className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border md:hidden"
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

              <Accordion type="single" collapsible>
                {toolCategories.map((category) => (
                  <AccordionItem key={category.id} value={category.id} className="border-border">
                    <AccordionTrigger className="px-3 py-2 text-sm font-medium hover:no-underline">
                      {category.label}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-1 pb-1">
                        {getToolsByCategory(category.id).map((tool) => (
                          <Link
                            key={tool.id}
                            to={tool.route}
                            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => setIsOpen(false)}
                          >
                            <tool.icon className="h-4 w-4 shrink-0" />
                            {tool.name}
                          </Link>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>

              <Link to="/#tools" onClick={() => setIsOpen(false)}>
                <Button size="sm" className="mt-2 w-full">
                  Explore tools
                </Button>
              </Link>
              <Link to="/premium" onClick={() => setIsOpen(false)}>
                <Button size="sm" variant="outline" className="w-full">
                  Premium
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
