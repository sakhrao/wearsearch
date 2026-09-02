import Link from "next/link";
import type { DiscoveryCategory } from "@/lib/discovery";

export function DiscoveryCategories({
  categories,
}: {
  categories: DiscoveryCategory[];
}) {
  if (categories.length === 0) {
    return null;
  }

  const grouped = categories.reduce<
    { group: string; items: DiscoveryCategory[] }[]
  >((acc, category) => {
    const last = acc[acc.length - 1];
    if (last && last.group === category.group) {
      last.items.push(category);
    } else {
      acc.push({ group: category.group, items: [category] });
    }
    return acc;
  }, []);

  return (
    <div
      id="discover"
      role="region"
      aria-labelledby="browse-categories-title"
      className="scroll-mt-24 py-16 sm:py-20"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Explore by style
        </p>
        <h2
          id="browse-categories-title"
          className="mt-3 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl"
        >
          Find styles you love
        </h2>
        <p className="mt-3 text-ink-soft">
          Browse by category — the perfect starting point for your
          next search.
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-4xl space-y-8">
        {grouped.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
              {group}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((category) => (
                <Link
                  key={category.id}
                  href={`/?q=${encodeURIComponent(category.name)}`}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-5 py-4 transition hover:border-accent/50 hover:shadow-md"
                >
                  <span>
                    <span className="block text-base font-medium text-ink">
                      {category.name}
                    </span>
                    <span className="mt-1 block text-sm text-ink-faint">
                      {category.count}{" "}
                      {category.count === 1
                        ? "product"
                        : "products"}
                    </span>
                  </span>

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="size-5 text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent"
                  >
                    <path d="M5 12h14" />
                    <path d="m13 6 6 6-6 6" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}