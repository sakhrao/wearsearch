/* "Brands we cover" editorial section. Shows the FULL named brand
   roster the catalog source plan covers - not just the brands
   currently holding inventory. Brands live today get the solid
   treatment; planned-only brands stay outlined, so the page both
   shows off the breadth and stays honest about what's in stock. */
import { PLAN_BRANDS } from "@/lib/catalog/import-plan";
import { SectionHeading } from "@/components/section-heading";

export function BrandsCoveredSection({
  liveBrands,
}: {
  liveBrands: string[];
}) {
  const liveSet = new Set(liveBrands);
  const roster = [...new Set([...PLAN_BRANDS, ...liveBrands])].sort(
    (a, b) => a.localeCompare(b)
  );
  const liveCount = roster.filter((name) => liveSet.has(name))
    .length;

  return (
    <section
      aria-labelledby="brands-covered-title"
      className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10"
    >
      <SectionHeading
        id="brands-covered-title"
        eyebrow="The catalog"
        title="Brands we cover"
        description={`One catalog, ${roster.length} houses — from sportswear giants and streetwear staples to watches and luxury maisons. Solid chips are already in stock today; the rest are part of our import plan.`}
      />

      <p className="mt-6 text-sm font-medium text-ink-soft">
        {liveCount} of {roster.length} brands in today&apos;s
        catalog
      </p>

      <ul className="mt-4 flex flex-wrap gap-2.5">
        {roster.map((brand) =>
          liveSet.has(brand) ? (
            <li
              key={brand}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-paper"
            >
              {brand}
            </li>
          ) : (
            <li
              key={brand}
              className="rounded-full border border-line bg-paper-soft px-3.5 py-1.5 text-xs font-medium text-ink-soft"
            >
              {brand}
            </li>
          )
        )}
      </ul>

      <p className="mt-6 text-xs text-ink-faint">
        Solid = available now · Outline = arriving in a future
        import wave
      </p>
    </section>
  );
}