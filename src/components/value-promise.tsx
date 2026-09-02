const PILLARS = [
  {
    title: "Search by description",
    copy: "Describe the piece you have in mind in plain words — color, style, size or budget — and we'll find the pieces that match.",
    icon: "text",
  },
  {
    title: "Shop from trusted stores",
    copy: "Every product link takes you straight to a real store page, so you can shop with confidence.",
    icon: "link",
  },
  {
    title: "Results that fit",
    copy: "Matches are ranked by how well they fit what you asked for, and easy to fine-tune from there.",
    icon: "bars",
  },
] as const;

function PillarIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "size-5",
  };
  if (name === "link") {
    return (
      <svg {...common}>
        <path d="M12 3v4M12 17v4" />
        <path d="M19 12h4M1 12h4" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  }
  if (name === "text") {
    return (
      <svg {...common}>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <path d="m8.5 4.5 2 2 4-4" opacity="0" />
    </svg>
  );
}

export function ValuePromise() {
  return (
    <div role="region" aria-label="Why WearSearch" className="py-16 sm:py-20">
      <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-3">
        {PILLARS.map((pillar) => (
          <div key={pillar.title} className="text-center sm:text-left">
            <span className="inline-grid size-11 place-items-center rounded-xl border border-line bg-surface text-accent">
              <PillarIcon name={pillar.icon} />
            </span>
            <h3 className="mt-4 text-base font-semibold text-ink">
              {pillar.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {pillar.copy}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}