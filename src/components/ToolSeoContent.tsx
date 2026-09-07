import { Link } from "react-router-dom";
import { pdfTools, PDFTool } from "@/lib/tools";
import type { ToolContent } from "@/lib/seo";

/** Sibling tools that share a category, most-popular first. */
function relatedTools(tool: PDFTool, limit = 4): PDFTool[] {
  return pdfTools
    .filter(
      (candidate) =>
        candidate.id !== tool.id &&
        candidate.category.some((category) => tool.category.includes(category))
    )
    .sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)))
    .slice(0, limit);
}

interface ToolSeoContentProps {
  tool: PDFTool;
  content: ToolContent;
}

/**
 * The readable half of a tool landing page: what the tool does, how to use it,
 * the questions people actually ask, and a way onwards. Rendered under every
 * tool so each route is a real page rather than an uploader with a heading.
 */
const ToolSeoContent = ({ tool, content }: ToolSeoContentProps) => {
  const related = relatedTools(tool);

  return (
    <section className="mx-auto mt-12 max-w-3xl border-t border-border pt-10">
      <h2 className="text-2xl font-bold text-foreground">
        About the {tool.name} tool
      </h2>
      <p className="mt-3 leading-relaxed text-muted-foreground">{content.intro}</p>

      <h2 className="mt-10 text-2xl font-bold text-foreground">
        Free online {tool.name.toLowerCase()}
      </h2>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        PDF Palette’s {tool.name} tool is free to use in your browser with no account and no watermark
        on your download. Upload your file on this page, run the tool, and save the result when it is ready.
      </p>

      <h2 className="mt-10 text-2xl font-bold text-foreground">
        How to {tool.name.toLowerCase()}
      </h2>
      <ol className="mt-4 space-y-3">
        {content.steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {index + 1}
            </span>
            <span className="leading-relaxed text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>

      <h2 className="mt-10 text-2xl font-bold text-foreground">
        Frequently asked questions
      </h2>
      <dl className="mt-4 divide-y divide-border border-y border-border">
        {content.faqs.map((faq) => (
          <div key={faq.q} className="py-4">
            <dt className="font-semibold text-foreground">{faq.q}</dt>
            <dd className="mt-1.5 leading-relaxed text-muted-foreground">{faq.a}</dd>
          </div>
        ))}
      </dl>

      {related.length > 0 && (
        <>
          <h2 className="mt-10 text-2xl font-bold text-foreground">Related tools</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {related.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.route}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
                >
                  <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span>
                    <span className="block font-medium text-foreground">{item.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {item.description}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

export default ToolSeoContent;
