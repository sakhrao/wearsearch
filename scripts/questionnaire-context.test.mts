/* Stage 3-A questionnaire context (pure, no DB).

   A static fixture documenting the REAL catalog rows observed in the
   Stage-2 audit (43 contextual groups): MEN Sneakers/Boots EU only,
   WOMEN Sneakers EU+US (with the US 35-45 cluster kept tagged US),
   WOMEN Blouses INTERNATIONAL, UNISEX accessions, and empty Kids /
   Accessories / Headwear.

   Invariants:
   - the catalog is built only from Product->Variant->Size rows (the
     fixture), so nothing is invented for audiences/categories with no
     data;
   - system is contextual truth: US 35-45 stays in the US column, never
     loosely merged or re-read as EU;
   - sections derive from audience + category exactly like the engine's
     genderMatches (UNISEX rows are eligible for every audience but a
     MEN/WOMEN/KIDS row never leaks into another audience);
   - clothing collapses to one generic section; shoes split per system;
   - null audience/category yield no section. */

import {
  buildSizeCatalog,
  sizeSectionsFor,
  type ContextualSizeRow,
} from "../src/lib/sizes";
import { genderToAudience } from "../src/lib/questionnaire";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail ?? ""}`);
  }
}

const rows: ContextualSizeRow[] = [
  /* MEN -- Sneakers EU 42/43 (real; no MEN US at all) */
  { audience: "MEN", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "42", ordinal: 1 },
  { audience: "MEN", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "43", ordinal: 2 },
  /* MEN -- Boots EU 41..44 */
  { audience: "MEN", productType: "FOOTWEAR", category: "Boots", system: "EU", value: "41", ordinal: 0 },
  { audience: "MEN", productType: "FOOTWEAR", category: "Boots", system: "EU", value: "42", ordinal: 1 },
  { audience: "MEN", productType: "FOOTWEAR", category: "Boots", system: "EU", value: "43", ordinal: 2 },
  { audience: "MEN", productType: "FOOTWEAR", category: "Boots", system: "EU", value: "44", ordinal: 3 },
  /* WOMEN -- Sneakers EU 39/40 + US 5.5..11 and the 35..45 cluster */
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "39", ordinal: 0 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "40", ordinal: 1 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "US", value: "5.5", ordinal: 0 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "US", value: "6", ordinal: 1 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "US", value: "7", ordinal: 2 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "US", value: "11", ordinal: 3 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "US", value: "35", ordinal: 4 },
  { audience: "WOMEN", productType: "FOOTWEAR", category: "Sneakers", system: "US", value: "45", ordinal: 9 },
  /* WOMEN -- Blouses INTERNATIONAL XS..XXXL + One Size */
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "XXS", ordinal: 0 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "XS", ordinal: 1 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "S", ordinal: 2 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "M", ordinal: 3 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "L", ordinal: 4 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "XL", ordinal: 5 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "XXL", ordinal: 6 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "XXXL", ordinal: 7 },
  { audience: "WOMEN", productType: "CLOTHING", category: "Blouses", system: "INTERNATIONAL", value: "One Size", ordinal: 8 },
  /* UNISEX -- Polos INTERNATIONAL S..XL + Sneakers EU 40..44 */
  { audience: "UNISEX", productType: "CLOTHING", category: "Polos", system: "INTERNATIONAL", value: "S", ordinal: 0 },
  { audience: "UNISEX", productType: "CLOTHING", category: "Polos", system: "INTERNATIONAL", value: "M", ordinal: 1 },
  { audience: "UNISEX", productType: "CLOTHING", category: "Polos", system: "INTERNATIONAL", value: "L", ordinal: 2 },
  { audience: "UNISEX", productType: "CLOTHING", category: "Polos", system: "INTERNATIONAL", value: "XL", ordinal: 3 },
  { audience: "UNISEX", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "40", ordinal: 0 },
  { audience: "UNISEX", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "42", ordinal: 1 },
  { audience: "UNISEX", productType: "FOOTWEAR", category: "Sneakers", system: "EU", value: "44", ordinal: 2 },
];

const catalog = buildSizeCatalog(rows);

const q = (json: string) => JSON.stringify(JSON.parse(json));

/* 1. Catalog shape: all four audiences present as fixed entries. */
const audienceKeys = Object.keys(catalog) as (keyof typeof catalog)[];
check(
  "catalog has MEN/WOMEN/KIDS/UNISEX entries",
  audienceKeys.length === 4 &&
    ["MEN", "WOMEN", "KIDS", "UNISEX"].every((a) =>
      catalog[a as keyof typeof catalog]
    ) &&
    audienceKeys.every(
      (a) =>
        Array.isArray(catalog[a].CLOTHING) &&
        Array.isArray(catalog[a].FOOTWEAR)
    ),
  Object.keys(catalog).join(",")
);

/* 2. System truth: WOMEN Sneakers US holds the 5.5..45 cluster in the
   US column; EU holds only 39/40, and none of 5.5/35/45. */
const womenSneakers = catalog.WOMEN.FOOTWEAR.find((c) => c.name === "Sneakers");
const usSection = womenSneakers?.systems.find((s) => s.system === "US");
const euSection = womenSneakers?.systems.find((s) => s.system === "EU");
check(
  "WOMEN Sneakers EU = [39,40]",
  q(JSON.stringify(euSection?.values)) === q(JSON.stringify(["39", "40"])),
  JSON.stringify(euSection?.values)
);
check(
  "WOMEN Sneakers US keeps 35-45 tagged US (no reinterpretation)",
  usSection !== undefined &&
    usSection.values.includes("5.5") &&
    usSection.values.includes("35") &&
    usSection.values.includes("45") &&
    usSection.values[usSection.values.length - 1] === "45",
  JSON.stringify(usSection?.values)
);
check(
  "WOMEN Sneakers EU never contains 5.5/35/45",
  euSection !== undefined && !euSection.values.some((v) => ["5.5", "35", "45"].includes(v)),
  JSON.stringify(euSection?.values)
);

/* 3. No cross-audience leak: MEN Boots values are MEN-only. */
const menBoots = catalog.MEN.FOOTWEAR.find((c) => c.name === "Boots");
const womenBoots = catalog.WOMEN.FOOTWEAR.find((c) => c.name === "Boots");
check(
  "MEN Boots = EU 41..44 only",
  menBoots?.systems.length === 1 &&
    menBoots.systems[0].system === "EU" &&
    q(JSON.stringify(menBoots.systems[0].values)) === q(JSON.stringify(["41", "42", "43", "44"])),
  JSON.stringify(menBoots?.systems)
);
check(
  "WOMEN Boots absent (no rows -> no invented sizes)",
  womenBoots === undefined,
  JSON.stringify(womenBoots)
);

/* 4. Sections (the find-page derivation). */
const womenSections = sizeSectionsFor({
  audience: genderToAudience("women"),
  categoryName: "Sneakers",
  catalog,
});
check(
  "WOMEN Sneakers -> two per-system sections EU then US",
  womenSections.length === 2 && womenSections[0].system === "EU" && womenSections[1].system === "US",
  JSON.stringify(womenSections)
);
check(
  "WOMEN Sneakers EU section label shows merged range EU (39-44) (39/40 from WOMEN + 40/42/44 UNISEX)",
  womenSections[0].label === "EU (39\u201344)" &&
    q(JSON.stringify(womenSections[0].values)) ===
      q(JSON.stringify(["39", "40", "42", "44"])),
  `label=${womenSections[0].label} values=${JSON.stringify(womenSections[0].values)}`
);
check(
  "WOMEN Sneakers US section keeps the truthful full cluster",
  q(JSON.stringify(womenSections[1].values)) === q(JSON.stringify(["5.5", "6", "7", "11", "35", "45"])),
  JSON.stringify(womenSections[1]?.values)
);

const menSections = sizeSectionsFor({
  audience: genderToAudience("men"),
  categoryName: "Sneakers",
  catalog,
});
check(
  "MEN Sneakers -> only the EU column (no MEN US)",
  menSections.length === 1 && menSections[0].system === "EU" &&
    menSections[0].values.every((v) => !v.includes(".")),
  JSON.stringify(menSections)
);

/* 5. UNISEX merge mirrors genderMatches: men + Polos reach the
   UNISEX S..XL rows; women + Polos equally. */
const menPolos = sizeSectionsFor({ audience: "MEN", categoryName: "Polos", catalog });
const womenPolos = sizeSectionsFor({ audience: "WOMEN", categoryName: "Polos", catalog });
check(
  "men Polos -> UNISEX clothing S,M,L,XL (single generic section)",
  menPolos.length === 1 && menPolos[0].system === null &&
    q(JSON.stringify(menPolos[0].values)) === q(JSON.stringify(["S", "M", "L", "XL"])),
  JSON.stringify(menPolos)
);
check(
  "women Polos -> same UNISEX surface",
  q(JSON.stringify(womenPolos)) === q(JSON.stringify(menPolos)),
  JSON.stringify(womenPolos)
);

/* 6. UNISEX merge for shoes keeps system columns. */
const menUnisexSneakers = sizeSectionsFor({ audience: "MEN", categoryName: "Sneakers", catalog });
check(
  "men Sneakers merges UNISEX EU 40/44 into one EU column",
  menUnisexSneakers.length === 1 &&
    q(JSON.stringify(menUnisexSneakers[0].values)) === q(JSON.stringify(["40", "42", "43", "44"])),
  JSON.stringify(menUnisexSneakers)
);

/* 7. No leak into Kids / categories with no data. KIDS is
   kids-only: the adult UNISEX sneaker rows are never offered to a
   children's context, so Kids + Sneakers -> nothing. */
const kidsSections = sizeSectionsFor({ audience: "KIDS", categoryName: "Sneakers", catalog });
check(
  "kids Sneakers -> nothing (kids-only audience, no invented kids sizes)",
  kidsSections.length === 0,
  JSON.stringify(kidsSections)
);
const accessories = sizeSectionsFor({ audience: "WOMEN", categoryName: "Sunglasses", catalog });
check(
  "accessories/headwear -> no sections (page shows No sizes available)",
  accessories.length === 0,
  JSON.stringify(accessories)
);
const noCategory = sizeSectionsFor({ audience: "WOMEN", categoryName: null, catalog });
const noGender = sizeSectionsFor({ audience: null, categoryName: "Sneakers", catalog });
check(
  "null category/gender -> no sections",
  noCategory.length === 0 && noGender.length === 0
);

/* 8. Clothing is a single generic section (no cooking label). */
const womenBlouses = sizeSectionsFor({ audience: "WOMEN", categoryName: "Blouses", catalog });
check(
  "women Blouses -> one generic clothing section with canonical alpha order",
  womenBlouses.length === 1 && womenBlouses[0].label === null && womenBlouses[0].system === null &&
    q(JSON.stringify(womenBlouses[0].values)) ===
      q(JSON.stringify(["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "One Size"])),
  JSON.stringify(womenBlouses)
);

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed === 0 ? 0 : 1);