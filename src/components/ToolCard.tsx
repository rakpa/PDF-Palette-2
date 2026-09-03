import { Link } from "react-router-dom";
import { PDFTool } from "@/lib/tools";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ToolCardProps {
  tool: PDFTool;
}

const colorClasses = {
  coral: "bg-tool-coral/15 text-tool-coral group-hover:bg-tool-coral/25",
  green: "bg-tool-green/15 text-tool-green group-hover:bg-tool-green/25",
  blue: "bg-tool-blue/15 text-tool-blue group-hover:bg-tool-blue/25",
  yellow: "bg-tool-yellow/15 text-tool-yellow group-hover:bg-tool-yellow/25",
  purple: "bg-tool-purple/15 text-tool-purple group-hover:bg-tool-purple/25",
  orange: "bg-tool-orange/15 text-tool-orange group-hover:bg-tool-orange/25",
  teal: "bg-tool-teal/15 text-tool-teal group-hover:bg-tool-teal/25",
  pink: "bg-tool-pink/15 text-tool-pink group-hover:bg-tool-pink/25",
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
          {tool.comingSoon ? (
            <Badge
              variant="secondary"
              className="h-5 px-2 text-[11px] font-medium text-muted-foreground"
            >
              Soon
            </Badge>
          ) : (
            tool.popular && (
              <Badge className="h-5 bg-primary/10 px-2 text-[11px] font-medium text-primary hover:bg-primary/10">
                Popular
              </Badge>
            )
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
          <Icon className="h-6 w-6 sm:h-8 sm:w-8" strokeWidth={2.4} aria-hidden />
        </div>

        <div className="min-w-0 flex-1 sm:flex-none">
          <h3 className="mb-0.5 pr-12 text-base font-bold leading-snug text-zinc-900 dark:text-zinc-50 sm:mb-1.5 sm:pr-16 sm:text-lg">
            {tool.name}
          </h3>
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
            {tool.description}
          </p>
        </div>
      </article>
    </Link>
  );
};

export default ToolCard;
