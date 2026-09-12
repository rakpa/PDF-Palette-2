import { Link } from "react-router-dom";
import { pdfTools, type PDFTool } from "@/lib/tools";
import type { ToolContent } from "@/lib/seo";
import ToolCard from "@/components/ToolCard";

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

/** Body copy uses solid black in light mode so the guide is easy to read. */
const bodyText = "text-black dark:text-foreground";

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n\n+/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => (
          <p key={block.slice(0, 48)} className={`mt-3 leading-relaxed ${bodyText}`}>
            {block}
          </p>
        ))}
    </>
  );
}

/**
 * Long-form how-to guide under each tool converter: structured sections,
 * FAQs, internal links, and related tools. Page H1 stays the tool name above.
 */
const ToolSeoContent = ({ tool, content }: ToolSeoContentProps) => {
  const related = relatedTools(tool);
  const linkedRoutes = new Set(content.internalLinks.map((l) => l.route));
  const relatedFiltered = related.filter((item) => !linkedRoutes.has(item.route));

  return (
    <article className={`mx-auto mt-12 max-w-3xl border-t border-border pt-10 ${bodyText}`}>
      <div>
        <Paragraphs text={content.intro} />
      </div>

      {content.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="text-2xl font-bold text-black dark:text-foreground">
            {section.heading}
          </h2>
          {section.body ? <Paragraphs text={section.body} /> : null}
          {section.steps && section.steps.length > 0 ? (
            <ol className="mt-4 space-y-3">
              {section.steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className={`leading-relaxed ${bodyText}`}>{step}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {section.subsections?.map((sub) => (
            <div key={sub.heading} className="mt-6">
              <h3 className="text-lg font-semibold text-black dark:text-foreground">
                {sub.heading}
              </h3>
              <Paragraphs text={sub.body} />
            </div>
          ))}
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-black dark:text-foreground">
          Frequently asked questions
        </h2>
        <dl className="mt-4 divide-y divide-border border-y border-border">
          {content.faqs.map((faq) => (
            <div key={faq.q} className="py-4">
              <dt className="font-semibold text-black dark:text-foreground">{faq.q}</dt>
              <dd className={`mt-1.5 leading-relaxed ${bodyText}`}>{faq.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-black dark:text-foreground">Wrap-up</h2>
        <Paragraphs text={content.conclusion} />
      </section>

      {content.internalLinks.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-bold text-black dark:text-foreground">
            Related guides on PDF Palette
          </h2>
          <ul className={`mt-4 list-disc space-y-2 pl-5 ${bodyText}`}>
            {content.internalLinks.map((link) => (
              <li key={link.route}>
                <Link
                  to={link.route}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {link.anchor}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {relatedFiltered.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-bold text-black dark:text-foreground">Related tools</h2>
          <ul className="mt-4 grid list-none gap-4 p-0 sm:grid-cols-2">
            {relatedFiltered.map((item) => (
              <li key={item.id}>
                <ToolCard tool={item} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
};

export default ToolSeoContent;
