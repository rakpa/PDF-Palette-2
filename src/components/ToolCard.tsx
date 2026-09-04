import { Link } from "react-router-dom";
import { PDFTool } from "@/lib/tools";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ToolCardProps {
  tool: PDFTool;
}

const colorClasses = {
  coral: "bg-tool-coral text-white shadow-sm group-hover:brightness-110",
  green: "bg-tool-green text-white shadow-sm group-hover:brightness-110",
  blue: "bg-tool-blue text-white shadow-sm group-hover:brightness-110",
  yellow: "bg-tool-yellow text-white shadow-sm group-hover:brightness-110",
  purple: "bg-tool-purple text-white shadow-sm group-hover:brightness-110",
  orange: "bg-tool-orange text-white shadow-sm group-hover:brightness-110",
  teal: "bg-tool-teal text-white shadow-sm group-hover:brightness-110",
  pink: "bg-tool-pink text-white shadow-sm group-hover:brightness-110",
};

const ToolCard = ({ tool }: ToolCardProps) => {
  const Icon = tool.icon;

  return (
    <Link to={tool.route} className="group block h-full">
      <article
        className={cn(
          "relative flex h-full flex-row items-center gap-4 rounded-xl border border-black bg-card p-4 shadow-card transition-all duration-300",
          "sm:flex-col sm:items-stretch sm:rounded-2xl sm:p-6",
          "hover:-translate-y-0.5 hover:shadow-card-hover sm:hover:-translate-y-1"
        )}
      >
        <div className="absolute right-3 top-3 flex gap-1.5 sm:right-4 sm:top-4">
          {tool.popular && (
            <Badge className="h-5 bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/10">
              Popular
            </Badge>
          )}
          {tool.isNew && !tool.popular && (
            <Badge className="h-5 bg-tool-green px-2 text-[11px] text-white hover:bg-tool-green/90">
              New
            </Badge>
          )}
        </div>

        <div
          className={cn(
            "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors sm:mb-4 sm:h-16 sm:w-16 sm:rounded-2xl",
            colorClasses[tool.color]
          )}
        >
          <Icon className="h-6 w-6 sm:h-8 sm:w-8" strokeWidth={2.25} aria-hidden />
        </div>

        <div className="min-w-0 flex-1 sm:flex-none">
          <h3 className="mb-0.5 pr-12 text-base font-bold leading-snug text-black dark:text-white sm:mb-1.5 sm:pr-16 sm:text-lg">
            {tool.name}
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-[0.9375rem]">
            {tool.description}
          </p>
        </div>
      </article>
    </Link>
  );
};

export default ToolCard;
