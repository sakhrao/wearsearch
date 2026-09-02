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
      className="scroll-mt-24 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          How it works
        </p>
        <h2
          id="how-it-works-title"
          className="mt-3 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl"
        >
          From words to a wardrobe, in three steps
        </h2>
        <p className="mt-3 text-ink-soft">
          Describe the piece you have in mind and we&apos;ll bring
          the matches to you.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {STEPS.map((step) => (
          <div
            key={step.number}
            className="rounded-2xl border border-line bg-surface p-6 transition hover:border-accent/40 hover:shadow-sm"
          >
            <p className="font-display text-2xl font-medium text-accent">
              {step.number}
            </p>
            <h3 className="mt-3 text-base font-semibold text-ink">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {step.copy}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}