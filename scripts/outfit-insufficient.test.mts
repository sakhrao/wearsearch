import { buildOutfits } from "../src/lib/outfit/outfit-builder";
import type { OutfitProduct, Gender } from "../src/lib/outfit/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

let n = 0;
function mk(over: Partial<OutfitProduct> & { slug?: string; gender?: Gender | null }): OutfitProduct {
  n++;
  const slug = over.slug ?? "sneakers";
  return {
    id: `p${n}`,
    name: over.name ?? `Product ${n}`,
    price: over.price ?? "30",
    currency: "EUR",
    productUrl: over.productUrl ?? `https://shop.example.com/p/${n}`,
    imageUrl: null,
    availability: over.availability ?? "AVAILABLE",
    gender: over.gender ?? "WOMEN",
    brand: { id: "b", name: "Brand" },
    category: { id: `c${n}`, slug: over.category?.slug ?? slug, name: over.category?.name ?? slug },
    variants:
      over.variants ??
      [{ price: "30", currency: "EUR", availability: "AVAILABLE", color: { name: "White", hex: null } }],
    attributes: over.attributes ?? [],
  };
}

/* Anchor: WOMEN sneakers. Compatible bottoms need to come from
   trousers/jeans/joggers/chinos/leggings. We provide only tops and
   NO bottoms -> bottom slot must be missing, complete:false, and the
   engine must NOT reach for a wrong-category/wrong-gender product to
   fake completeness. */

const anchor = mk({
  name: "WOMEN white sneaker",
  slug: "sneakers",
  gender: "WOMEN",
  variants: [{ price: "60", currency: "EUR", availability: "AVAILABLE", color: { name: "White", hex: null } }],
});

// A valid top (t-shirt).
const top = mk({
  name: "WOMEN white tee",
  slug: "t-shirts",
  gender: "WOMEN",
  variants: [{ price: "20", currency: "EUR", availability: "AVAILABLE", color: { name: "White", hex: null } }],
  category: { id: "ctee", slug: "t-shirts", name: "T-Shirts" },
});

// A tempting bottom that is the WRONG gender (MEN trousers) — must NOT
// be used to complete a WOMEN outfit.
const menTrousers = mk({
  name: "MEN trousers (wrong gender)",
  slug: "trousers",
  gender: "MEN",
  variants: [{ price: "40", currency: "EUR", availability: "AVAILABLE", color: { name: "Black", hex: "#000000" } }],
  category: { id: "ctr", slug: "trousers", name: "Trousers" },
});

// A demo bottom (no real page) — must NOT be used.
const demoBottom = {
  ...mk({
    name: "demo jeans (no real page)",
    slug: "jeans",
    gender: "WOMEN",
    category: { id: "cjean", slug: "jeans", name: "Jeans" },
  }),
  productUrl: "", // F1: no real page
  id: "demo-1",
};

// An out-of-stock bottom — must NOT be used.
const oosBottom = mk({
  name: "OOS legging",
  slug: "leggings",
  gender: "WOMEN",
  availability: "OUT_OF_STOCK",
  variants: [{ price: "25", currency: "EUR", availability: "OUT_OF_STOCK", color: { name: "Black", hex: null } }],
  category: { id: "cleg", slug: "leggings", name: "Leggings" },
});

const products: OutfitProduct[] = [anchor, top, menTrousers, demoBottom, oosBottom];

const outfits = buildOutfits({
  anchor,
  occasion: null,
  style: null,
  budget: null,
  products,
  rate: 1,
});

check("returns at least one outfit object", outfits.length >= 1, `got ${outfits.length}`);
const o = outfits[0];
check("outfit is NOT complete when a required slot cannot be filled", o.complete === false);
check("missingSlots includes bottom", o.missingSlots.includes("bottom"));
// The item made it into the outfit is only the anchor + top (nothing
// fabricated, nothing wrong-gender/demo/OOS).
const itemIds = o.items.map((i) => i.product.id);
check("anchor always present", itemIds.includes(anchor.id));
check("valid top present", itemIds.includes(top.id));
check("MEN wrong-gender bottom NOT used", !itemIds.includes(menTrousers.id));
check("demo (no real page) bottom NOT used", !itemIds.includes(demoBottom.id));
check("OOS bottom NOT used", !itemIds.includes(oosBottom.id));
// Only anchor + top referenced (no partial fake fill).
check("no fabricated items beyond real ones", o.items.every((i) => [anchor.id, top.id].includes(i.product.id)));

console.log(`\noutfit-insufficient: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
