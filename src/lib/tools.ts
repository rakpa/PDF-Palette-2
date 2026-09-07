import {
  FileStack,
  Scissors,
  RotateCw,
  Minimize2,
  FileText,
  FileSpreadsheet,
  Presentation,
  Image,
  Code,
  Edit3,
  Droplets,
  PenTool,
  Lock,
  Unlock,
  Crop,
  Hash,
  LayoutGrid,
  Trash2,
  FileOutput,
  FormInput,
  EyeOff,
  Scale,
  ScanText,
  LucideIcon,
} from "lucide-react";

export type ToolCategory =
  | "all"
  | "organize"
  | "optimize"
  | "convert-to"
  | "convert-from"
  | "edit"
  | "security";

/** Client-side capabilities implemented in the browser. Every tool has one. */
export type ToolFeature =
  | "merge"
  | "split"
  | "rotate"
  | "compress"
  | "watermark"
  | "jpg-to-pdf"
  | "word-to-pdf"
  | "word-to-pdf-ilove"
  | "pdf-to-word"
  | "pdf-to-word-new"
  | "pdf-to-word-ilove"
  | "unlock-pdf"
  | "protect-pdf"
  | "html-to-pdf"
  | "edit-pdf"
  | "sign-pdf"
  | "organize-pages"
  | "remove-pages"
  | "extract-pages"
  | "page-numbers"
  | "crop-pdf"
  | "pdf-to-jpg"
  | "excel-to-pdf"
  | "ppt-to-pdf"
  | "pdf-to-excel"
  | "pdf-to-ppt"
  | "fill-forms"
  | "redact"
  | "compare"
  | "ocr";

export interface PDFTool {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: "coral" | "green" | "blue" | "yellow" | "purple" | "orange" | "teal" | "pink";
  category: ToolCategory[];
  isNew?: boolean;
  /** Shown with a subtle highlight on the homepage grid. */
  popular?: boolean;
  route: string;
  feature: ToolFeature;
}

/**
 * Homepage display order — most widely used tools first.
 * PDF ↔ Word and Compress lead; then merge/split, image convert,
 * other Office convert, everyday edit/security, then niche tools.
 */
export const pdfTools: PDFTool[] = [
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    description: "Convert PDF to editable Word documents",
    icon: FileText,
    color: "blue",
    category: ["convert-from"],
    popular: true,
    route: "/pdf-to-word",
    feature: "pdf-to-word-ilove",
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    description: "Convert Word documents to PDF",
    icon: FileText,
    color: "blue",
    category: ["convert-to"],
    popular: true,
    route: "/word-to-pdf",
    feature: "word-to-pdf-ilove",
  },
  {
    id: "compress",
    name: "Compress PDF",
    description: "Reduce file size while keeping quality",
    icon: Minimize2,
    color: "green",
    category: ["optimize"],
    popular: true,
    route: "/compress-pdf",
    feature: "compress",
  },
  {
    id: "merge",
    name: "Merge PDF",
    description: "Combine multiple PDFs into one document",
    icon: FileStack,
    color: "coral",
    category: ["organize"],
    popular: true,
    route: "/merge-pdf",
    feature: "merge",
  },
  {
    id: "split",
    name: "Split PDF",
    description: "Split by page ranges or into one PDF per page",
    icon: Scissors,
    color: "purple",
    category: ["organize"],
    popular: true,
    route: "/split-pdf",
    feature: "split",
  },
  {
    id: "pdf-to-jpg",
    name: "PDF to JPG",
    description: "Convert PDF pages to high-quality images",
    icon: Image,
    color: "yellow",
    category: ["convert-from"],
    popular: true,
    route: "/pdf-to-jpg",
    feature: "pdf-to-jpg",
  },
  {
    id: "jpg-to-pdf",
    name: "JPG to PDF",
    description: "Convert images to PDF documents",
    icon: Image,
    color: "yellow",
    category: ["convert-to"],
    popular: true,
    route: "/jpg-to-pdf",
    feature: "jpg-to-pdf",
  },
  {
    id: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Extract tables from PDF to Excel",
    icon: FileSpreadsheet,
    color: "green",
    category: ["convert-from"],
    route: "/pdf-to-excel",
    feature: "pdf-to-excel",
  },
  {
    id: "excel-to-pdf",
    name: "Excel to PDF",
    description: "Convert Excel spreadsheets to PDF",
    icon: FileSpreadsheet,
    color: "green",
    category: ["convert-to"],
    route: "/excel-to-pdf",
    feature: "excel-to-pdf",
  },
  {
    id: "pdf-to-ppt",
    name: "PDF to PowerPoint",
    description: "Convert PDF to editable presentations",
    icon: Presentation,
    color: "orange",
    category: ["convert-from"],
    route: "/pdf-to-powerpoint",
    feature: "pdf-to-ppt",
  },
  {
    id: "ppt-to-pdf",
    name: "PowerPoint to PDF",
    description: "Convert presentations to PDF format",
    icon: Presentation,
    color: "orange",
    category: ["convert-to"],
    route: "/powerpoint-to-pdf",
    feature: "ppt-to-pdf",
  },
  {
    id: "edit",
    name: "Edit PDF",
    description: "Add text, images, shapes and annotations to PDF",
    icon: Edit3,
    color: "coral",
    category: ["edit"],
    popular: true,
    route: "/edit-pdf",
    feature: "edit-pdf",
  },
  {
    id: "sign",
    name: "Sign PDF",
    description: "Draw, type or upload a signature and place it",
    icon: PenTool,
    color: "purple",
    category: ["security", "edit"],
    route: "/sign-pdf",
    feature: "sign-pdf",
  },
  {
    id: "ocr",
    name: "OCR PDF",
    description: "Make scanned pages searchable and selectable",
    icon: ScanText,
    color: "teal",
    category: ["edit", "convert-from"],
    route: "/ocr-pdf",
    feature: "ocr",
  },
  {
    id: "unlock",
    name: "Unlock PDF",
    description: "Remove password protection from PDF",
    icon: Unlock,
    color: "pink",
    category: ["security"],
    route: "/unlock-pdf",
    feature: "unlock-pdf",
  },
  {
    id: "protect",
    name: "Protect PDF",
    description: "Add password protection to your PDF",
    icon: Lock,
    color: "coral",
    category: ["security"],
    route: "/protect-pdf",
    feature: "protect-pdf",
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    description: "Rotate PDF pages to the correct orientation",
    icon: RotateCw,
    color: "blue",
    category: ["organize"],
    route: "/rotate-pdf",
    feature: "rotate",
  },
  {
    id: "organize",
    name: "Organize PDF",
    description: "Reorder, rotate, duplicate and delete pages visually",
    icon: LayoutGrid,
    color: "purple",
    category: ["organize"],
    route: "/organize-pdf",
    feature: "organize-pages",
  },
  {
    id: "watermark",
    name: "Watermark PDF",
    description: "Add text or image watermark to PDF",
    icon: Droplets,
    color: "teal",
    category: ["edit"],
    route: "/watermark-pdf",
    feature: "watermark",
  },
  {
    id: "html-to-pdf",
    name: "HTML to PDF",
    description: "Convert web pages to PDF format",
    icon: Code,
    color: "teal",
    category: ["convert-to"],
    route: "/html-to-pdf",
    feature: "html-to-pdf",
  },
  {
    id: "extract-pages",
    name: "Extract Pages",
    description: "Pull selected pages out into a new PDF",
    icon: FileOutput,
    color: "teal",
    category: ["organize"],
    route: "/extract-pages",
    feature: "extract-pages",
  },
  {
    id: "remove-pages",
    name: "Remove Pages",
    description: "Delete the pages you don't want to keep",
    icon: Trash2,
    color: "coral",
    category: ["organize"],
    route: "/remove-pages",
    feature: "remove-pages",
  },
  {
    id: "page-numbers",
    name: "Add Page Numbers",
    description: "Number pages, with your own position and format",
    icon: Hash,
    color: "blue",
    category: ["edit"],
    route: "/page-numbers",
    feature: "page-numbers",
  },
  {
    id: "crop",
    name: "Crop PDF",
    description: "Trim margins and set a new visible page area",
    icon: Crop,
    color: "green",
    category: ["edit"],
    route: "/crop-pdf",
    feature: "crop-pdf",
  },
  {
    id: "fill-forms",
    name: "Fill PDF Forms",
    description: "Fill in a PDF's form fields, and lock them if you like",
    icon: FormInput,
    color: "orange",
    category: ["edit"],
    isNew: true,
    route: "/fill-forms",
    feature: "fill-forms",
  },
  {
    id: "redact",
    name: "Redact PDF",
    description: "Permanently remove text and images from a PDF",
    icon: EyeOff,
    color: "coral",
    category: ["security"],
    isNew: true,
    route: "/redact-pdf",
    feature: "redact",
  },
  {
    id: "compare",
    name: "Compare PDF",
    description: "See what changed between two versions of a PDF",
    icon: Scale,
    color: "purple",
    category: ["security"],
    isNew: true,
    route: "/compare-pdf",
    feature: "compare",
  },
];

export const categories = [
  { id: "all", label: "All Tools" },
  { id: "organize", label: "Organize PDF" },
  { id: "convert-to", label: "Convert To PDF" },
  { id: "convert-from", label: "Convert From PDF" },
  { id: "optimize", label: "Optimize PDF" },
  { id: "edit", label: "Edit PDF" },
  { id: "security", label: "Security" },
] as const;

export const getToolsByCategory = (category: ToolCategory): PDFTool[] => {
  if (category === "all") return pdfTools;
  return pdfTools.filter((tool) => tool.category.includes(category));
};

export const getToolById = (id: string): PDFTool | undefined => {
  return pdfTools.find((tool) => tool.id === id);
};

export const getToolByRoute = (route: string): PDFTool | undefined => {
  return pdfTools.find((tool) => tool.route === route);
};
