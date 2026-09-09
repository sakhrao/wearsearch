import Link from "next/link";

export function OutfitPromo() {
  return (
    <div
      role="region"
      aria-labelledby="outfit-promo-title"
      className="py-16 sm:py-24"
    >
      <div className="relative overflow-hidden bg-ink px-6 py-16 sm:px-16 sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full border border-paper/15"
        />
        <div className="relative mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-paper/70">
            Outfit Engine
          </p>
          <h2
            id="outfit-promo-title"
            className="mt-4 font-display text-3xl font-medium tracking-tight text-paper sm:text-4xl"
          >
            Complete the look.
          </h2>
          <p className="mt-4 text-paper/70">
            Found the perfect piece? Build an outfit around it —
            style, occasion and palette handled for you.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/outfit"
              className="rounded-full bg-paper px-8 py-3.5 text-sm font-semibold text-ink transition hover:bg-paper-soft"
            >
              Build an outfit
            </Link>
            <Link
              href="/find"
              className="rounded-full border border-paper/40 px-7 py-3.5 text-sm font-medium text-paper transition hover:bg-paper hover:text-ink"
            >
              Answer a few questions
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}