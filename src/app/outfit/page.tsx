import { Suspense } from "react";

import { getSpotlightCategories } from "@/lib/discovery";
import type { FeaturedProduct } from "@/lib/discovery";

import { OutfitClient } from "./outfit-client";

/* Suggested pieces come straight from the catalog so the studio
   landing never shows stale products after a re-sync. */
export const dynamic = "force-dynamic";

export default async function OutfitRoute() {
  const spotlights = await getSpotlightCategories();

  const suggestions: FeaturedProduct[] = [];
  for (const slot of spotlights) {
    if (slot.representativeProduct) {
      suggestions.push(slot.representativeProduct);
    }
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-paper p-12 text-ink">
          Loading…
        </div>
      }
    >
      <OutfitClient suggestions={suggestions} />
    </Suspense>
  );
}