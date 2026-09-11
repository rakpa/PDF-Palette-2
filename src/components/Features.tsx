import { motion } from "framer-motion";
import { ShieldCheck, Zap, Gift, Cpu } from "lucide-react";

const features = [
  {
    icon: ShieldCheck,
    title: "Private by design",
    description:
      "All tools use browser-based processing. Your files are handled in your tab — see our Privacy Policy.",
    // Vivid emerald
    iconColor: "#00C853",
    iconBg: "rgba(0, 200, 83, 0.18)",
  },
  {
    icon: Zap,
    title: "Lightning fast",
    description:
      "No waiting in queues. Results are ready the moment processing finishes.",
    // Bright amber / gold
    iconColor: "#FFB300",
    iconBg: "rgba(255, 179, 0, 0.2)",
  },
  {
    icon: Gift,
    title: "Free forever",
    description:
      "Every tool is free to use with no sign-up and no watermark on your files.",
    // Hot rose / pink
    iconColor: "#FF2D55",
    iconBg: "rgba(255, 45, 85, 0.16)",
  },
  {
    icon: Cpu,
    title: "Nothing to install",
    description:
      "There's no app to download and no account to create — open a tool in a tab and it's ready to use.",
    // Bright sky blue
    iconColor: "#0091FF",
    iconBg: "rgba(0, 145, 255, 0.16)",
  },
];

const Features = () => {
  return (
    <section className="border-y border-border/50 bg-muted/30 py-16">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-12 text-center"
        >
          <h2 className="mb-3 text-3xl font-bold text-foreground">
            Why you’ll love it
          </h2>
          <p className="mx-auto max-w-xl text-muted-foreground">
            Powerful PDF tools that respect your privacy and your time.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="rounded-2xl border border-border/50 bg-card p-6 shadow-card transition-all hover:-translate-y-1 hover:shadow-card-hover"
            >
              <div
                className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl"
                style={{ backgroundColor: feature.iconBg, color: feature.iconColor }}
              >
                <feature.icon className="h-6 w-6" strokeWidth={2.25} />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
