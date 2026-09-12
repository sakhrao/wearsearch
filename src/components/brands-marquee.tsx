"use client";

import { useState } from "react";
import { SectionHeading } from "@/components/section-heading";
import { PLAN_BRANDS } from "@/lib/catalog/import-plan";
import { brandLogoSlug } from "@/lib/brand-logos";

/* Brand mark in a marquee slide: the Simple Icons logo when the
   brand resolves, otherwise a typographic wordmark. The onError
   swap keeps missing/unverified icons invisible-safe. */
function BrandMark({ name }: { name: string }) {
  const slug = brandLogoSlug(name);
  const [fellBack, setFellBack] = useState(false);

  if (!slug || fellBack) {
    return (
      <span className="font-display text-2xl font-semibold tracking-tight text-ink">
        {name}
      </span>
    );
  }

  return (
    <img
      src={`https://cdn.simpleicons.org/${slug}`}
      alt={`${name} logo`}
      loading="lazy"
      onError={() => setFellBack(true)}
      className="h-8 w-auto max-w-44 object-contain"
    />
  );
}

export function BrandsMarquee({
  liveBrands,
}: {
  liveBrands: string[];
}) {
  const roster = [
    ...new Set([...PLAN_BRANDS, ...liveBrands]),
  ].sort((a, b) => a.localeCompare(b));

  if (roster.length === 0) {
    return null;
  }

  /* Duplicated track makes a seamless infinite loop (translateX
     -50% needs two copies side by side). */
  const track = [...roster, ...roster];

  return (
    <section
      aria-labelledby="brands-marquee-title"
      className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-10"
    >
      <SectionHeading
        id="brands-marquee-title"
        eyebrow="The catalog"
        title="Brands we cover"
        description={`From sportswear giants to luxury houses — ${roster.length} named brands, one catalog.`}
      />

      <div
        className="brand-marquee mt-8"
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
    </section>
  );
}