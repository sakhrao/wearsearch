import Link from "next/link";
import { notFound } from "next/navigation";

import { loadProductDetail, type ProductDetail } from "@/lib/product-detail";
import { SizeGuide } from "@/components/size-guide";

export const dynamic = "force-dynamic";

function availabilityLabel(availability: string): string {
  switch (availability) {
    case "AVAILABLE":
      return "Available";
    case "OUT_OF_STOCK":
      return "Out of stock";
    default:
      return "Availability unknown";
  }
}

const SIZE_STATE_NOTE: Record<ProductDetail["sizes"][number]["state"], string> = {
  RESOLVED: "Recognised size",
  UNRESOLVED: "Size not recognised — shown exactly as the store lists it",
  NOT_BACKFILLED: "Size not yet processed — shown exactly as the store lists it",
};

export default async function ProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await loadProductDetail(productId);
  if (!product) notFound();

  const primaryOffer =
    product.offers.find((offer) => offer.isPrimary) ?? product.offers[0] ?? null;

  const carriedSizeOptionIds = [
    ...new Set(
      product.sizes
        .filter((size) => size.state === "RESOLVED" && size.canonicalSizeOptionId)
        .map((size) => size.canonicalSizeOptionId as string)
    ),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      {/* Breadcrumb / taxonomy path */}
      <nav className="mb-6 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        {product.categoryPath.map((node) => (
          <span key={node.id} className="flex items-center gap-2">
            <span aria-hidden>/</span>
            <span className="text-ink-soft">{node.name}</span>
          </span>
        ))}
      </nav>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* Gallery */}
        <div>
          <div className="overflow-hidden rounded-2xl border border-line bg-paper-soft">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                className="aspect-[4/5] w-full object-cover"
              />
            ) : (
              <div className="grid aspect-[4/5] w-full place-items-center text-sm text-ink-faint">
                No image
              </div>
            )}
          </div>

          {product.gallery.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              {product.gallery.slice(0, 8).map((url) => (
                <div
                  key={url}
                  className="overflow-hidden rounded-xl border border-line bg-paper-soft"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={product.name} className="aspect-square w-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          {product.brand && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              {product.brand.name}
            </p>
          )}
          <h1 className="mt-2 font-display text-3xl font-medium leading-tight text-ink">
            {product.name}
          </h1>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold text-ink">
              {product.price} {product.currency}
            </span>
            <span className="rounded-full border border-line bg-paper-soft px-3 py-1 text-xs font-medium text-ink-soft">
              {availabilityLabel(product.availability)}
            </span>
            {product.gender && (
              <span className="rounded-full border border-line bg-paper-soft px-3 py-1 text-xs font-medium text-ink-soft">
                {product.gender}
              </span>
            )}
          </div>

          <dl className="mt-5 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-faint">Source:</dt>
              <dd className="text-ink-soft">{product.sourceLabel}</dd>
            </div>
            {primaryOffer && (
              <div className="flex gap-2">
                <dt className="text-ink-faint">Listing:</dt>
                <dd className="break-all text-ink-soft">{primaryOffer.externalListingId}</dd>
              </div>
            )}
          </dl>

          {product.description && (
            <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-ink-soft">
              {product.description}
            </p>
          )}

          {/* External source link (preserved; never fabricated) */}
          <div className="mt-5 flex flex-wrap gap-3">
            {product.hasRealProductPage ? (
              <a
                href={product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink-soft"
              >
                Open at {product.sourceLabel}
              </a>
            ) : (
              <span className="rounded-full bg-paper-soft px-5 py-2.5 text-sm font-medium text-ink-faint">
                No external product page available
              </span>
            )}
          </div>

          {/* Attributes */}
          {product.attributes.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {product.attributes
                .filter((a) => a.value.trim() !== "" && a.value.trim().toLowerCase() !== "n/a")
                .slice(0, 8)
                .map((a, index) => (
                  <span
                    key={`${a.name}-${a.value}-${index}`}
                    className="rounded-full bg-paper-soft px-3 py-1 text-xs text-ink-soft"
                  >
                    {a.name}: {a.value}
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Sizes + Size Guide */}
      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-xl font-medium text-ink">Sizes</h2>
          {product.sizes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">
              This product does not list sizes.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {product.sizes.map((size) => (
                  <span
                    key={`${size.state}-${size.canonicalSizeOptionId ?? ""}-${size.label}-${size.system ?? ""}`}
                    title={`${SIZE_STATE_NOTE[size.state]}${size.system ? ` · ${size.system}` : ""}`}
                    className={[
                      "rounded-full border px-3 py-1.5 text-sm",
                      size.available
                        ? "border-ink/30 text-ink"
                        : "border-dashed border-line text-ink-faint line-through",
                      size.state === "RESOLVED" ? "bg-paper-soft" : "bg-transparent",
                    ].join(" ")}
                  >
                    {size.label}
                    {size.system ? (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-ink-faint">
                        {size.system}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-faint">
                {product.resolvedCount} recognised · {product.unresolvedCount} not
                recognised · {product.notBackfilledCount} not yet processed
              </p>
              {product.hasUnresolved && (
                <p className="mt-2 text-xs text-ink-soft">
                  Unrecognised sizes are shown exactly as the store lists them and
                  are never reinterpreted as another size.
                </p>
              )}
            </>
          )}
        </section>

        <SizeGuide
          chart={product.chart}
          carriedSizeOptionIds={carriedSizeOptionIds}
        />
      </div>

      {/* Offers */}
      {product.offers.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-medium text-ink">Where to buy</h2>
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
            {product.offers.map((offer) => (
              <li
                key={offer.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {offer.sourceLabel}
                    {offer.isPrimary ? (
                      <span className="ml-2 rounded-full bg-paper-soft px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
                        Primary
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink-soft">{availabilityLabel(offer.availability)}</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-ink-soft">
                    {offer.price} {offer.currency}
                  </span>
                  {offer.hasRealPage ? (
                    <a
                      href={offer.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition hover:bg-ink-soft"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="rounded-lg bg-paper-soft px-3 py-1.5 text-xs font-medium text-ink-faint">
                      No page
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
