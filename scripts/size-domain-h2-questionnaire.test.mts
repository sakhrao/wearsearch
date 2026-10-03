/* Stage H / H2 — Questionnaire → canonical size selection → search.

   Pure contract tests, no dev server required:
     - the questionnaire normalizer adapter derives the one canonical
       identity (and never invents one for an unresolved value);
     - the category → SizeCategoryId classification matches the
       vocabulary module;
     - the URL channel carries `size` / `sizeSystem` round-trip;
     - the edit-search restore rebuilds the answer from the canonical
       filter without re-guessing context;
     - the Stage F filter predicate receives the derived identity. */

import {
  canonicalizeQuestionnaireSize,
  parseCanonicalSizeOptionId,
} from "../src/lib/size-domain/questionnaire";
import { sizeCategoryIdForCategory } from "../src/lib/catalog/size-vocabulary";
import {
  filterByCanonicalSize,
  findProductIdsBySizeFilter,
  matchesCanonicalSize,
  type CanonicalSizeFilter,
} from "../src/lib/size-domain/query";

import "dotenv/config";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { SizeCanonicalFields } from "../src/lib/size-domain/persist";
import {
  buildSearchQueryString,
  parseSearchUrl,
  searchIntentKey,
} from "../src/lib/search-url";
import { buildEditAnswers } from "../src/lib/questionnaire-restore";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const clothing = (audience: "MEN" | "WOMEN" | "KIDS" | "UNISEX") =>
  ({ audience, productType: "CLOTHING", system: null, category: "clothing" }) as const;

const footwear = (
  audience: "MEN" | "WOMEN",
  system: string | null
) => ({ audience, productType: "FOOTWEAR", system }) as const;

const fields = (
  canonicalSizeOptionId: string | null,
  sizeResolutionStatus: string | null,
  sizeResolutionSystem: string | null = null
): SizeCanonicalFields => ({
  canonicalSizeOptionId,
  sizeResolutionStatus,
  sizeResolutionProvenance: null,
  sizeResolutionSystem,
});

async function main() {
  /* ---------------- adapter: normalization ------------- */

  const xs = canonicalizeQuestionnaireSize("XS", clothing("WOMEN"));
  const m = canonicalizeQuestionnaireSize("M", clothing("WOMEN"));
  const xl = canonicalizeQuestionnaireSize("XL", clothing("WOMEN"));
  const medium = canonicalizeQuestionnaireSize("Medium", clothing("WOMEN"));
  const med = canonicalizeQuestionnaireSize("Med", clothing("WOMEN"));
  const twoXl = canonicalizeQuestionnaireSize("2XL", clothing("WOMEN"));
  const threeXl = canonicalizeQuestionnaireSize("3XL", clothing("WOMEN"));

  check(
    "H2-1 XS/M/XL resolve to their canonical identities",
    xs.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|XS" &&
      m.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M" &&
      xl.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|XL",
    JSON.stringify([xs.canonicalSizeOptionId, m.canonicalSizeOptionId, xl.canonicalSizeOptionId])
  );

  check(
    "H2-2 Medium/Med alias to M",
    medium.canonicalValue === "M" &&
      medium.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M" &&
      med.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M"
  );

  check(
    "H2-3 2XL/3XL alias to XXL/XXXL",
    twoXl.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|XXL" &&
      threeXl.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|XXXL"
  );

  check(
    "H2-4 source label is preserved (Medium stays Medium)",
    medium.sourceLabel === "Medium" && medium.resolutionStatus === "RESOLVED"
  );

  check(
    "H2-5 M+MEN and M+WOMEN stay distinct identities",
    canonicalizeQuestionnaireSize("M", clothing("MEN")).canonicalSizeOptionId ===
      "MEN|clothing|INTERNATIONAL|M" &&
      m.canonicalSizeOptionId === "WOMEN|clothing|INTERNATIONAL|M"
  );

  /* ---------------- adapter: systems + discipline ------------- */

  const eu42 = canonicalizeQuestionnaireSize("42", footwear("WOMEN", "EU"));
  const us8 = canonicalizeQuestionnaireSize("8", footwear("WOMEN", "US"));

  check(
    "H2-6 US 8 and EU 42 never merge",
    us8.canonicalSizeOptionId === "WOMEN|shoes|US|8" &&
      eu42.canonicalSizeOptionId === "WOMEN|shoes|EU|42" &&
      (us8.canonicalSizeOptionId as string) !==
        (eu42.canonicalSizeOptionId as string)
  );

  const bare32 = canonicalizeQuestionnaireSize(
    "32",
    clothing("WOMEN")
  );
  check(
    "H2-7 bare numeric without a system stays unresolved with no identity",
    bare32.resolutionStatus === "UNRESOLVED" &&
      bare32.canonicalSizeOptionId === null,
    JSON.stringify(bare32)
  );

  const unattributed = canonicalizeQuestionnaireSize(
    "42",
    footwear("WOMEN", null)
  );
  check(
    "H2-8 footwear numeric without a system stays unresolved",
    unattributed.resolutionStatus === "UNRESOLVED" &&
      unattributed.canonicalSizeOptionId === null
  );

  const alphaShoe = canonicalizeQuestionnaireSize(
    "M",
    footwear("WOMEN", "EU")
  );
  check(
    "H2-9 clothing and footwear never share an identity (alpha in footwear unresolved)",
    alphaShoe.resolutionStatus === "UNRESOLVED" &&
      alphaShoe.canonicalSizeOptionId === null
  );

  /* ---------------- adapter: category context ------------- */

  const bra = canonicalizeQuestionnaireSize("36B", {
    audience: "WOMEN",
    productType: "CLOTHING",
    system: null,
    category: "bra",
  });
  const braNoCategory = canonicalizeQuestionnaireSize("36B", clothing("WOMEN"));

  check(
    "H2-10 bra resolves only with the bra category context",
    bra.resolutionStatus === "RESOLVED" &&
      bra.canonicalSizeOptionId === "WOMEN|clothing|BRA|36B" &&
      braNoCategory.resolutionStatus === "UNRESOLVED" &&
      braNoCategory.canonicalSizeOptionId === null,
    JSON.stringify([bra.canonicalSizeOptionId, braNoCategory.canonicalSizeOptionId])
  );

  const oneSize = canonicalizeQuestionnaireSize(
    "One Size",
    clothing("WOMEN")
  );
  check(
    "H2-11 One Size resolves to a real identity",
    oneSize.resolutionStatus === "RESOLVED" &&
      oneSize.canonicalSizeOptionId === "WOMEN|clothing|ONE_SIZE|One Size"
  );

  /* ---------------- category classification ------------- */

  const catId = (
    name: string,
    slug: string,
    rootSlug: string
  ) => sizeCategoryIdForCategory({ name, slug, rootSlug, group: "" });

  check(
    "H2-12 category classification reuses the vocabulary mapping",
    catId("Sneakers", "sneakers", "shoes") === "footwear" &&
      catId("Bras", "bras", "clothing") === "bra" &&
      catId("Socks", "socks", "accessories") === "socks" &&
      catId("Belts", "belts", "accessories") === "belt" &&
      catId("Hats", "hats", "headwear") === "hat" &&
      catId("Sunglasses", "sunglasses", "accessories") === "one_size" &&
      catId("Shirts", "shirts", "clothing") === "clothing"
  );

  /* ---------------- identity parse round-trip ------------- */

  const parsed = parseCanonicalSizeOptionId(
    "WOMEN|clothing|INTERNATIONAL|M"
  );
  const parsedShoe = parseCanonicalSizeOptionId("MEN|shoes|EU|42");

  check(
    "H2-13 identity parses back into context",
    parsed?.audience === "WOMEN" &&
      parsed?.productType === "CLOTHING" &&
      parsed?.system === "INTERNATIONAL" &&
      parsed?.value === "M" &&
      parsedShoe?.audience === "MEN" &&
      parsedShoe?.productType === "FOOTWEAR" &&
      parsedShoe?.system === "EU" &&
      parsedShoe?.value === "42"
  );

  check(
    "H2-14 malformed identity is rejected",
    parseCanonicalSizeOptionId("not-an-identity") === null
  );

  /* ---------------- Stage F filter receives the identity ------- */

  const identity = m.canonicalSizeOptionId as string;
  const filter: CanonicalSizeFilter = filterByCanonicalSize(identity);

  check(
    "H2-15 derived identity matches a RESOLVED row carrying it",
    matchesCanonicalSize(fields(identity, "RESOLVED"), identity) &&
      filter.canonicalSizeOptionId === identity
  );

  check(
    "H2-16 derived identity never matches an unresolved row",
    !matchesCanonicalSize(fields(null, "UNRESOLVED"), identity)
  );

  /* ---------------- URL channel round-trip ------------- */

  const intent = {
    query: "women",
    params: {
      priceMin: null,
      priceMax: null,
      soft: null,
      budgetCurrency: null,
      budgetDisplayMin: null,
      budgetDisplayMax: null,
      size: [identity],
      sizeSystem: [] as string[],
    },
  };
  const url = buildSearchQueryString(intent);
  const reparsed = parseSearchUrl(new URLSearchParams(url), null);

  check(
    "H2-17 size identity survives the URL round-trip",
    url.includes("size=") &&
      reparsed.kind === "ready" &&
      reparsed.intent.params.size.length === 1 &&
      reparsed.intent.params.size[0] === identity,
    url
  );

  const pinned = {
    ...intent,
    params: {
      ...intent.params,
      size: [] as string[],
      sizeSystem: ["EU"],
    },
  };
  const pinnedParsed = parseSearchUrl(
    new URLSearchParams(buildSearchQueryString(pinned)),
    null
  );

  check(
    "H2-18 sizeSystem pin survives the URL round-trip",
    pinnedParsed.kind === "ready" &&
      pinnedParsed.intent.params.sizeSystem[0] === "EU"
  );

  check(
    "H2-19 a different size changes the intent key",
    searchIntentKey(intent) !==
      searchIntentKey({
        ...intent,
        params: { ...intent.params, size: ["WOMEN|clothing|INTERNATIONAL|L"] },
      })
  );

  /* ---------------- edit-search restore ---------------- */

  const restored = buildEditAnswers("women", null, null, {
    size: [identity],
  });
  check(
    "H2-20 restore rebuilds the canonical size answer",
    restored.size?.canonicalSizeOptionId === identity &&
      restored.size?.value === "M" &&
      restored.size?.system === "INTERNATIONAL" &&
      restored.size?.resolutionStatus === "RESOLVED",
    JSON.stringify(restored.size)
  );

  const restoredPin = buildEditAnswers("women", null, null, {
    sizeSystem: ["EU"],
  });
  check(
    "H2-21 restore rebuilds a system pin as unresolved (no identity)",
    restoredPin.size?.canonicalSizeOptionId === null &&
      restoredPin.size?.system === "EU" &&
      restoredPin.size?.resolutionStatus === "UNRESOLVED"
  );

  const legacy = buildEditAnswers(
    "women m",
    { size: "M" },
    null,
    null
  );
  check(
    "H2-22 legacy bare size token still restores as unresolved",
    legacy.size?.value === "M" &&
      legacy.size?.canonicalSizeOptionId === null &&
      legacy.size?.resolutionStatus === "UNRESOLVED"
  );

  /* ---------------- DB: adapter reproduces real identities ------ */

  if (!process.env.DATABASE_URL) {
    console.log("H2: NOT_MEASURED — DATABASE_URL not configured");
    console.log(`\nH2_RESULTS passed=${passed} failed=${failed}`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const rows = await prisma.productVariant.findMany({
      where: {
        sizeResolutionStatus: "RESOLVED",
        canonicalSizeOptionId: { not: null },
      },
      select: { canonicalSizeOptionId: true },
      distinct: ["canonicalSizeOptionId"],
      take: 200,
    });

    const identities = rows
      .map((row) => row.canonicalSizeOptionId)
      .filter((id): id is string => id != null);

    let reproduced = 0;
    let comparable = 0;
    for (const id of identities) {
      const parsed = parseCanonicalSizeOptionId(id);
      if (
        !parsed ||
        parsed.audience == null ||
        parsed.audience === "UNKNOWN" ||
        parsed.value == null ||
        (parsed.productType !== "CLOTHING" &&
          parsed.productType !== "FOOTWEAR")
      ) {
        continue;
      }
      comparable += 1;
      const category =
        parsed.system === "BRA"
          ? "bra"
          : parsed.productType === "FOOTWEAR"
            ? "footwear"
            : "clothing";
      const again = canonicalizeQuestionnaireSize(parsed.value, {
        audience: parsed.audience as "MEN" | "WOMEN" | "KIDS" | "UNISEX",
        productType: parsed.productType,
        system: parsed.system,
        category,
      });
      if (again.canonicalSizeOptionId === id) reproduced += 1;
    }

    check(
      "H2-23 the adapter re-derives live stored identities verbatim",
      comparable >= 10 && reproduced === comparable,
      `comparable=${comparable} reproduced=${reproduced}`
    );

    const probe = identities[0] ?? null;
    const matchedIds = probe
      ? await findProductIdsBySizeFilter(
          prisma,
          filterByCanonicalSize(probe),
          { availability: "AVAILABLE" }
        )
      : [];

    check(
      "H2-24 a re-derived identity returns products at the DB boundary",
      probe != null && matchedIds.length > 0,
      `probe=${probe} matched=${matchedIds.length}`
    );
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nH2_RESULTS passed=${passed} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
