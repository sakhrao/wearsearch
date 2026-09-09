import Link from "next/link";
import type { FeaturedProduct } from "@/lib/discovery";
import { SectionHeading } from "@/components/section-heading";

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
      className="py-16 sm:py-24"
    >
      <SectionHeading
        id="featured-catalog-title"
        eyebrow="Trending finds"
        title="Discover something you'll love"
        description={
          "A handpicked selection of products to inspire your next search."
        }
      />

      <div className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <article key={product.id} className="group flex flex-col">
            <div className="relative aspect-[4/5] overflow-hidden bg-paper-soft">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
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

            <div className="flex flex-1 flex-col pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                {product.brand}
              </p>

              <h3 className="mt-1.5 font-display text-lg font-medium leading-snug text-ink">
                {product.name}
              </h3>

              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
                {product.category}
              </p>

              <div className="mt-4 flex flex-1 items-end justify-between gap-3">
                <div className="flex flex-1 gap-2">
                  <a
                    href={product.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-paper transition hover:bg-ink-soft"
                  >
                    View product
                  </a>
                  <Link
                    href={`/outfit?anchor=${encodeURIComponent(product.id)}`}
                    className="flex-1 rounded-full border border-line px-4 py-2.5 text-center text-sm font-medium text-ink-soft transition hover:border-ink hover:text-ink"
                  >
                    Style this item
                  </Link>
                </div>
                <span className="shrink-0 text-lg font-semibold text-ink">
                  {product.price} {product.currency}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}