const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

async function search(q) {
  const res = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`
  );

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for "${q}"`);
  }

  return res.json();
}

function hasPositiveComponent(product) {
  const m = product.structuredMatches ?? {};

  return (
    Object.values(m).some((v) => v === true) ||
    (product.matchedAttributes ?? 0) > 0
  );
}

const CHECKS = [
  {
    id: "SPEC-01",
    rule: "R1 gender compatibility is a hard filter",
    async run() {
      const d = await search("men cotton top");
      const leaked = [...d.exactProducts, ...d.similarProducts].filter(
        (p) => p.gender === "WOMEN"
      );
      return {
        pass: leaked.length === 0,
        detail:
          leaked.length === 0
            ? "no WOMEN product leaked into men-scoped search"
            : `leaked: ${leaked.map((p) => p.name).join(", ")}`,
      };
    },
  },
  {
    id: "SPEC-02",
    rule: "R2 exact and similar are disjoint",
    async run() {
      const d = await search("black tank top");
      const exactIds = new Set(d.exactProducts.map((p) => p.id));
      const overlap = d.similarProducts.filter((p) => exactIds.has(p.id));
      return {
        pass: overlap.length === 0,
        detail:
          overlap.length === 0
            ? "disjoint"
            : `overlap: ${overlap.map((p) => p.name).join(", ")}`,
      };
    },
  },
  {
    id: "SPEC-03",
    rule: "R3/R5 category+color match must outrank brand-only match (Tier order)",
    async run() {
      const d = await search("adidas brown shoes");
      const similar = d.similarProducts;
      const derbyIdx = similar.findIndex((p) => p.name === "Brown Classic Derby");
      const everydayIdx = similar.findIndex(
        (p) => p.name === "White Everyday Sneaker"
      );
      const relevant = derbyIdx >= 0 && everydayIdx >= 0;
      return {
        pass: relevant && derbyIdx < everydayIdx,
        detail: relevant
          ? `order: ${similar
              .map((p) => `${p.name}(${p.score})`)
              .join(" | ")}`
          : `missing candidates (derby=${derbyIdx}, everyday=${everydayIdx})`,
      };
    },
  },
  {
    id: "SPEC-04",
    rule: "R4 brand mismatch stays soft: right-category right-color rival must survive",
    async run() {
      const d = await search("adidas brown shoes");
      const derby = d.similarProducts.find(
        (p) => p.name === "Brown Classic Derby"
      );
      return {
        pass: Boolean(derby),
        detail: derby
          ? `present with score ${derby.score}`
          : "Brown Classic Derby (brand-mismatched) was excluded",
      };
    },
  },
  {
    id: "SPEC-05",
    rule: "R9/R10 category mismatch stays soft: right-category rivals must survive brand-scoped query",
    async run() {
      const d = await search("h&m jeans");
      const jeansLike = d.similarProducts.filter(
        (p) => ["Jeans", "Bottoms"].includes(p.category.name)
      );
      return {
        pass: jeansLike.length > 0,
        detail:
          jeansLike.length > 0
            ? `jeans present: ${jeansLike.map((p) => `${p.name}(${p.score})`).join(", ")}`
            : `similar contains only: ${d.similarProducts.map((p) => `${p.name}(${p.score})`).join(", ")}`,
      };
    },
  },
  {
    id: "SPEC-06",
    rule: "R7/R8 no zero-score similar: admitted candidates need strictly positive score",
    async run() {
      const d = await search("new balance sneaker");
      const zeros = d.similarProducts.filter((p) => p.score <= 0);
      return {
        pass: d.similarProducts.length > 0 && zeros.length === 0,
        detail:
          zeros.length === 0
            ? "all similar scores > 0"
            : `zero/nonpositive similar: ${zeros
                .map((p) => `${p.name}(${p.score})`)
                .join(", ")}`,
      };
    },
  },
  {
    id: "SPEC-07",
    rule: "R11 every admitted similar has at least one meaningful positive component",
    async run() {
      const noise = await search("xyzqqq");
      const colored = await search("green shoes");
      const bad = colored.similarProducts.filter(
        (p) => !hasPositiveComponent(p)
      );
      return {
        pass: noise.similarProducts.length === 0 && bad.length === 0,
        detail:
          noise.similarProducts.length > 0
            ? "noise query produced similar results"
            : bad.length > 0
              ? `no positive component: ${bad.map((p) => p.name).join(", ")}`
              : "noise empty; all colored-query similars have positive components",
      };
    },
  },
  {
    id: "SPEC-08",
    rule: "R6 explicit attribute mismatch causes observable penalty (demotion)",
    async run() {
      const without = await search("adidas sneaker");
      const withAttr = await search("adidas leather sneaker");
      const target = "White Everyday Sneaker";
      const baseScore = without.exactProducts.find((p) => p.name === target)?.score;
      const attrViolated = withAttr.similarProducts.find(
        (p) => p.name === target
      );
      const demoted =
        attrViolated &&
        baseScore !== undefined &&
        attrViolated.score < baseScore &&
        withAttr.exactProducts.every((p) => p.name !== target);
      return {
        pass: Boolean(demoted),
        detail: demoted
          ? `exact ${baseScore} -> similar ${attrViolated.score} after explicit material mismatch`
          : `without=${baseScore}, with=${attrViolated ? attrViolated.score : "absent"}`,
      };
    },
  },
  {
    id: "SPEC-09",
    rule: "R12/R13 similar sorted descending and deterministically across requests",
    async run() {
      const a = await search("sport top");
      const b = await search("sport top");
      const ordered = a.similarProducts.every(
        (p, i) =>
          i === 0 ||
          a.similarProducts[i - 1].score >= p.score
      );
      const seqA = a.similarProducts.map((p) => p.id).join(",");
      const seqB = b.similarProducts.map((p) => p.id).join(",");
      return {
        pass: ordered && seqA === seqB,
        detail: ordered
          ? seqA === seqB
            ? "descending + stable across requests"
            : "descending but unstable ordering between identical requests"
          : "not descending",
      };
    },
  },
  {
    id: "SPEC-10",
    rule: "R14 no negative scores exposed anywhere",
    async run() {
      const queries = [
        "adidas brown shoes",
        "h&m jeans",
        "new balance sneaker",
        "sport top",
        "slim fit black",
      ];
      const offenders = [];
      for (const q of queries) {
        const d = await search(q);
        for (const p of [...d.exactProducts, ...d.similarProducts]) {
          if (p.score < 0) {
            offenders.push(`${q}: ${p.name}(${p.score})`);
          }
        }
      }
      return {
        pass: offenders.length === 0,
        detail:
          offenders.length === 0
            ? "no negative scores exposed"
            : offenders.join("; "),
      };
    },
  },
];

async function main() {
  console.log("Similar Ranking Specification Suite (design phase)");
  console.log(`Target: ${BASE_URL}/api/search`);
  console.log(`Checks: ${CHECKS.length}\n`);

  let passed = 0;
  const failed = [];

  for (const check of CHECKS) {
    try {
      const { pass, detail } = await check.run();
      if (pass) {
        passed++;
        console.log(`PASS ${check.id} ${check.rule}`);
        console.log(`      ${detail}`);
      } else {
        failed.push({ id: check.id, rule: check.rule, detail });
        console.log(`FAIL ${check.id} ${check.rule}`);
        console.log(`      ${detail}`);
      }
    } catch (error) {
      failed.push({ id: check.id, rule: check.rule, detail: error.message });
      console.log(`FAIL ${check.id} ${check.rule}`);
      console.log(`      error: ${error.message}`);
    }
  }

  console.log(`\n================ RESULT ================`);
  console.log(`${passed}/${CHECKS.length} specification checks pass`);
  if (failed.length > 0) {
    console.log(`\nSpec gaps (candidates for Phase 6.3 scoring work):`);
    for (const f of failed) {
      console.log(`  ${f.id}: ${f.detail}`);
    }
    process.exit(1);
  }
}

main();
