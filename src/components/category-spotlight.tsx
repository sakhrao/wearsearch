import Link from "next/link";
import type { CategorySpotlight } from "@/lib/discovery";
import { SectionHeading } from "@/components/section-heading";
import { Reveal } from "@/components/reveal";

export function CategorySpotlight({
  spotlights,
}: {
  spotlights: CategorySpotlight[];
}) {
  if (spotlights.length === 0) {
    return null;
  }

  return (
    <div
      id="discover"
      role="region"
      aria-labelledby="spotlight-catalog-title"
      className="scroll-mt-24 py-16 sm:py-24"
    >
      <SectionHeading
        id="spotlight-catalog-title"
        eyebrow="Discover & explore"
        title="Shop the categories"
        description={
          "Six ways in — pick a category, see a real piece from it, " +
          "then open the full catalogue we actually carry."
        }
      />

      <div className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {spotlights.map(({ id, name, group, count, representativeProduct }, index) => (
          <Reveal
            key={id}
            delay={(index % 3) * 80}
            className="h-full"
          >
          <article className="group flex h-full flex-col">
            <Link
              href={`/?q=${encodeURIComponent(name)}`}
              className="flex items-baseline justify-between gap-4"
            >
              <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
                  {group}
                </span>
                <span className="font-display text-2xl font-medium tracking-tight text-ink transition group-hover:underline">
                  {name}
                </span>
              </span>

              <span className="shrink-0 text-sm text-ink-faint">
                {count} {count === 1 ? "product" : "products"}
              </span>
            </Link>

            <div className="relative mt-4 aspect-[4/5] overflow-hidden bg-paper-soft">
              {representativeProduct?.imageUrl ? (
                <img
                  src={representativeProduct.imageUrl}
                  alt={representativeProduct.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-sm text-ink-faint">
                  No image
                </div>
              )}
            </div>

            {representativeProduct && (
              <div className="min-h-0 flex-1 pt-4">
                <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-faint">
                  {representativeProduct.brand}
                </p>

                <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm text-ink">
                  {representativeProduct.name}
                </h3>

                <p className="mt-1 text-sm font-semibold text-ink">
                  {representativeProduct.price}{" "}
                  {representativeProduct.currency}
                </p>
              </div>
            )}

            <div className="mt-auto flex flex-col gap-2 pt-4">
              <Link
                href={`/?q=${encodeURIComponent(name)}`}
                className="flex-1 rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-paper transition hover:bg-ink-soft"
              >
                Discover all {name}
              </Link>

              {representativeProduct && (
                <a
                  href={representativeProduct.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-full border border-line px-4 py-2.5 text-center text-sm font-medium text-ink-soft transition hover:border-ink hover:text-ink"
                >
                  View this product
                </a>
              )}
            </div>
          </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={160}>
        <Link
          href="/find"
          className="group mt-12 flex items-center justify-between gap-6 rounded-2xl border border-line bg-surface px-6 py-8 transition hover:border-ink/30 sm:px-8"
        >
        <span>
          <span className="block font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">
            Not sure where to start?
          </span>
          <span className="mt-1 block text-sm text-ink-soft">
            Answer a few questions and we&apos;ll find the pieces
            that match you.
          </span>
        </span>

        <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-paper transition group-hover:bg-ink-soft">
          Discover all options
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="size-4"
          >
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </span>
      </Link>
      </Reveal>
    </div>
  );
}