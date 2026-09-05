import { Gift, ShieldCheck, UserCheck, Zap } from "lucide-react";

const trustIndicators = [
  { icon: Gift, label: "100% Free" },
  { icon: UserCheck, label: "No Registration" },
  { icon: ShieldCheck, label: "Private Processing" },
  { icon: Zap, label: "Fast & Browser-Based" },
];

const Hero = () => {
  return (
    <section className="border-b border-border/60 bg-card py-7 md:py-9">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl text-center">
          <h1 className="mb-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl md:mb-4 md:whitespace-nowrap md:text-[2.35rem] lg:text-4xl">
            27 PDF tools, most of them in{" "}
            <span className="text-primary">your browser</span>
          </h1>

          <p className="mx-auto mb-4 max-w-2xl text-sm text-muted-foreground md:mb-5 md:text-base">
            Merge, split, compress, convert, sign, OCR and edit — free and fast.
            PDF to Word and Word to PDF use CloudConvert.
          </p>

          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground md:text-sm">
            {trustIndicators.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-1">
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};

export default Hero;
