import Link from "next/link";
import type { FeaturedProduct } from "@/lib/discovery";

export function FeaturedProducts({
  products,
}: {
  products: FeaturedProduct[];
}) {
  if (products.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-labelledby="featured-catalog-title"
      className="py-16 sm:py-20"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Trending finds
        </p>
        <h2
          id="featured-catalog-title"
          className="mt-3 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl"
        >
          Discover something you&apos;ll love
        </h2>
        <p className="mt-3 text-ink-soft">
          A handpicked selection of products to inspire your next
          search.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <div
            key={product.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:shadow-lg"
          >
            <div className="aspect-[4/5] overflow-hidden bg-paper-soft">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-sm text-ink-faint">
                  No image
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-col p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {product.brand}
              </p>

                <h3 className="mt-1.5 text-base font-semibold leading-snug text-ink">
                {product.name}
              </h3>

              <p className="mt-1 text-sm text-ink-faint">
                {product.category}
              </p>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-lg font-semibold text-ink">
                  {product.price} {product.currency}
                </span>
              </div>

              <div className="mt-4 flex flex-1 items-end gap-2">
                <a
                  href={product.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-deep"
                >
                  View product
                </a>
                <Link
                  href={`/outfit?anchor=${encodeURIComponent(product.id)}`}
                  className="flex-1 rounded-full border border-line px-4 py-2.5 text-center text-sm font-medium text-ink-soft transition hover:border-accent/50 hover:text-accent"
                >
                  Style this item
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}