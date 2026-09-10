import { SectionHeading } from "@/components/section-heading";

const STEPS = [
  {
    number: "01",
    title: "Describe",
    copy: "Type what you're looking for in plain words — color, style, size or budget. No menus or fiddly forms.",
  },
  {
    number: "02",
    title: "Refine",
    copy: "Fine-tune your matches by category, color, size and brand until the results feel like you.",
  },
  {
    number: "03",
    title: "Discover",
    copy: "Explore exact and near matches, then open any piece on its store page to shop.",
  },
];

export function HowItWorks() {
  return (
    <div
      id="how-it-works"
      role="region"
      aria-labelledby="how-it-works-title"
      className="scroll-mt-24 py-16 sm:py-24"
    >
      <SectionHeading
        id="how-it-works-title"
        eyebrow="How it works"
        title="From words to a wardrobe, in three steps"
        description={
          "Describe the piece you have in mind and we'll bring " +
          "the matches to you."
        }
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div
            key={step.number}
            className="rounded-2xl border border-ink/15 bg-surface px-8 py-10 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.22)] sm:px-10"
          >
            <p className="font-display text-5xl font-light tracking-tight text-ink-faint">
              {step.number}
            </p>
            <h3 className="mt-6 text-base font-semibold text-ink">
              {step.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {step.copy}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}