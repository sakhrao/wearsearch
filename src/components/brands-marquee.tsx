"use client";

import { useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { PLAN_BRANDS } from "@/lib/catalog/import-plan";
import { brandLogoSlug } from "@/lib/brand-logos";

/* A marquee slide renders the verified brand glyph and nothing
   else — no name text. Brands without a verified logo are filtered
   from the roster entirely, so the strip is logos only. */
function BrandMark({ name }: { name: string }) {
  const slug = brandLogoSlug(name);
  const [fellBack, setFellBack] = useState(false);

  if (!slug || fellBack) {
    return null;
  }

  return (
    <img
      src={`https://cdn.simpleicons.org/${slug}`}
      alt={name}
      loading="lazy"
      onError={() => setFellBack(true)}
      className="h-9 w-auto max-w-44 object-contain"
    />
  );
}

export function BrandsMarquee({
  liveBrands,
}: {
  liveBrands: string[];
}) {
  const roster = [...new Set([...PLAN_BRANDS, ...liveBrands])]
    .filter((brand) => brandLogoSlug(brand) !== null)
    .sort((a, b) => a.localeCompare(b));

  if (roster.length === 0) {
    return null;
  }

  /* Duplicated track makes a seamless infinite loop (translateX
     -50% needs two copies side by side). Runs continuously and
     ignores pointer interaction by design. */
  const track = [...roster, ...roster];

  return (
    <section
      aria-labelledby="brands-marquee-title"
      className="scroll-mt-24 border-y border-line bg-paper-soft py-16 sm:py-24"
    >
      <div className="mx-auto w-full max-w-4xl px-4">
        <SectionHeading
          id="brands-marquee-title"
          eyebrow="The catalog"
          title="Brands we cover"
          description={`Search and shop every mark you see — straight from the catalog.`}
        />

        <div
          className="brand-marquee mt-12"
          role="list"
          aria-label="Brand logos"
        >
          <div className="brand-marquee-track">
            {track.map((brand, index) => (
              <div
                key={`${brand}-${index}`}
                className="brand-slide"
                role="listitem"
              >
                <BrandMark name={brand} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}