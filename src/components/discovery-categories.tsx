import Link from "next/link";
import type { DiscoveryCategory } from "@/lib/discovery";
import { SectionHeading } from "@/components/section-heading";

export function DiscoveryCategories({
  categories,
}: {
  categories: DiscoveryCategory[];
}) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <div
      id="discover"
      role="region"
      aria-labelledby="browse-categories-title"
      className="scroll-mt-24 py-16 sm:py-24"
    >
      <SectionHeading
        id="browse-categories-title"
        eyebrow="Explore by style"
        title="Shop the categories"
        description={
          "Browse the catalogue we actually carry — every count is real, " +
          "every piece can be opened on its store page."
        }
      />

      <div className="mt-12 divide-y divide-line border-y border-line">
        {categories.map(({ id, name, group, count }) => (
          <Link
            key={id}
            href={`/?q=${encodeURIComponent(name)}`}
            className="group flex items-baseline justify-between gap-6 px-2 py-6 transition hover:bg-paper-soft sm:px-4"
          >
            <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-faint">
                {group}
              </span>
              <span className="font-display text-2xl font-medium tracking-tight text-ink transition group-hover:underline sm:text-3xl">
                {name}
              </span>
            </span>

            <span className="shrink-0 text-sm text-ink-faint">
              {count} {count === 1 ? "product" : "products"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}