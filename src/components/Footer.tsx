import { Link } from "react-router-dom";
import { FileText, Github } from "lucide-react";
import AdSenseUnit from "./AdSenseUnit";

const Footer = () => {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container mx-auto px-4 py-12">
        <AdSenseUnit placement="site-footer" className="mb-10" />
        <div className="grid gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <FileText className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">PDF Palette</span>
            </Link>
            <p className="mt-4 text-sm text-muted-foreground">
              Free PDF tools that mostly run in your browser. A few conversions (PDF to Word,
              Word to PDF, PDF to PowerPoint, PDF to Excel, OCR, and HTML from a URL) use a
              conversion service — see our{" "}
              <Link to="/privacy" className="underline hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          {/* Tools */}
          <div>
            <h4 className="mb-4 font-semibold text-foreground">Popular Tools</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/pdf-to-word" className="hover:text-foreground transition-colors">
                  PDF to Word
                </Link>
              </li>
              <li>
                <Link to="/word-to-pdf" className="hover:text-foreground transition-colors">
                  Word to PDF
                </Link>
              </li>
              <li>
                <Link to="/compress-pdf" className="hover:text-foreground transition-colors">
                  Compress PDF
                </Link>
              </li>
              <li>
                <Link to="/merge-pdf" className="hover:text-foreground transition-colors">
                  Merge PDF
                </Link>
              </li>
            </ul>
          </div>

          {/* Convert */}
          <div>
            <h4 className="mb-4 font-semibold text-foreground">Convert</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/pdf-to-jpg" className="hover:text-foreground transition-colors">
                  PDF to JPG
                </Link>
              </li>
              <li>
                <Link to="/jpg-to-pdf" className="hover:text-foreground transition-colors">
                  JPG to PDF
                </Link>
              </li>
              <li>
                <Link to="/pdf-to-excel" className="hover:text-foreground transition-colors">
                  PDF to Excel
                </Link>
              </li>
              <li>
                <Link to="/excel-to-pdf" className="hover:text-foreground transition-colors">
                  Excel to PDF
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="mb-4 font-semibold text-foreground">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link to="/about" className="hover:text-foreground transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-foreground transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="hover:text-foreground transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/contact" className="hover:text-foreground transition-colors">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} PDF Palette. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/rakpa/PDF-Palette-2"
              className="text-muted-foreground hover:text-foreground transition-colors"
              rel="noopener noreferrer"
              target="_blank"
              aria-label="PDF Palette on GitHub"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
