/* "Brands we cover" editorial section. Instead of dumping the full
   45-house roster, each category card features its two most prominent
   brands (by real inventory count), so the breadth is communicated
   through the catalog's own data - never a fabricated claim. */
import { SectionHeading } from "@/components/section-heading";
import { PLAN_BRANDS } from "@/lib/catalog/import-plan";
import type { BrandHighlight } from "@/lib/discovery";

export function BrandsCoveredSection({
  highlights,
  liveBrands,
}: {
  highlights: BrandHighlight[];
  liveBrands: string[];
}) {
  const rosterCount = new Set([
    ...PLAN_BRANDS,
    ...liveBrands,
  ]).size;

  return (
    <section
      aria-labelledby="brands-covered-title"
      className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10"
    >
      <SectionHeading
        id="brands-covered-title"
        eyebrow="The catalog"
        title="Brands we cover"
        description={`One catalog, one stop per category. Each card shows the two leading houses in that category today — and the rest of the ${rosterCount} brand families we source from stays a search away.`}
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.map((category) => (
          <article
            key={category.id}
            className="group rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-ink/30"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink">
              {category.name}
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              {category.count}{" "}
              {category.count === 1 ? "style" : "styles"}
            </p>

            <div className="mt-5 flex flex-col gap-4">
              {category.brands.map((brand, index) => (
                <div
                  key={brand.name}
                  className="flex items-baseline justify-between gap-3 border-t border-line pt-3.5"
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-xs font-medium tabular-nums text-ink-faint">
                      0{index + 1}
                    </span>
                    <h3 className="font-display text-2xl font-medium leading-none tracking-tight text-ink">
                      {brand.name}
                    </h3>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                    {brand.count}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <p className="mt-8 text-xs text-ink-faint">
        Ranked by inventory today · {rosterCount} brand families in
        our sourcing plan
      </p>
    </section>
  );
}