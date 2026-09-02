import Link from "next/link";

export function OutfitPromo() {
  return (
    <div
      role="region"
      aria-labelledby="outfit-promo-title"
      className="py-16 sm:py-20"
    >
      <div className="relative overflow-hidden rounded-3xl border border-accent/20 bg-accent-tint px-6 py-14 sm:px-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent/10"
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Outfit Engine
          </p>
          <h2
            id="outfit-promo-title"
            className="mt-3 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl"
          >
            Complete the look.
          </h2>
          <p className="mt-4 text-ink-soft">
            Found the perfect piece? Build an outfit around it —
            style, occasion and palette handled for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/outfit"
              className="rounded-full bg-accent px-8 py-3.5 text-sm font-semibold text-white shadow transition hover:bg-accent-deep"
            >
              Build an outfit
            </Link>
            <Link
              href="/find"
              className="rounded-full border border-accent/30 bg-surface px-7 py-3.5 text-sm font-medium text-accent transition hover:bg-accent/5"
            >
              Answer a few questions
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}