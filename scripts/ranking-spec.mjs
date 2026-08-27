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

const RATIO_KEYS = [
  "brand",
  "category",
  "color",
  "size",
  "gender",
  "attributes",
];

function ratioOf(product) {
  const matches = product.structuredMatches ?? {};
  const constraints = RATIO_KEYS.filter(
    (key) => matches[key] !== null
  );
  if (constraints.length === 0) return 1;
  const matched = RATIO_KEYS.filter(
    (key) => matches[key] === true
  ).length;
  return matched / constraints.length;
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
    rule: "R3 (gate v7.1) brand/attribute-mismatch rivals drop below the 80% threshold: no Similar item has ratio < 80%",
    async run() {
      const d = await search("adidas brown shoes");
      const below = d.similarProducts.filter((p) => ratioOf(p) < 0.8);
      return {
        pass:
          (d.similarCount === 0 && Boolean(d.similarMessage)) ||
          below.length === 0,
        detail:
          below.length > 0
            ? `below-80% similar: ${below
                .map((p) => `${p.name}`)
                .join(", ")}`
            : `similar=${d.similarCount} message=${d.similarMessage ?? "none"}`,
      };
    },
  },
  {
    id: "SPEC-04",
    rule: "R4 (gate v7.1) brand mismatch hard-cut: right-category rival is excluded when it matches <80% of constraints",
    async run() {
      const d = await search("adidas brown shoes");
      const derby = d.similarProducts.find(
        (p) => p.name === "Brown Classic Derby"
      );
      return {
        pass: !derby && Boolean(d.similarMessage),
        detail: derby
          ? `Derby survived at ratio ${ratioOf(derby)}`
          : "Derby (brand-mismatched, <80%) hard-excluded; no-similar message shown",
      };
    },
  },
  {
    id: "SPEC-05",
    rule: "R9/R10 (gate v7.1) category mismatch hard-cut: no low-ratio rivals survive brand-scoped queries",
    async run() {
      const d = await search("h&m jeans");
      const below = d.similarProducts.filter((p) => ratioOf(p) < 0.8);
      return {
        pass:
          (d.similarCount === 0 && Boolean(d.similarMessage)) ||
          below.length === 0,
        detail:
          below.length > 0
            ? `below-80% similar: ${below.map((p) => p.name).join(", ")}`
            : `similar=${d.similarCount} message=${d.similarMessage ?? "none"}`,
      };
    },
  },
  {
    id: "SPEC-06",
    rule: "R7/R8 (gate v7.1) gated similar may be empty: an empty Similar with the 80% message is the correct outcome when no candidate reaches the threshold",
    async run() {
      const d = await search("new balance sneaker");
      const zeroOrLow = d.similarProducts.filter(
        (p) => p.score <= 0 || ratioOf(p) < 0.8
      );
      return {
        pass:
          (d.similarCount === 0 && Boolean(d.similarMessage)) ||
          zeroOrLow.length === 0,
        detail:
          zeroOrLow.length > 0
            ? `zero/low similar: ${zeroOrLow.map((p) => p.name).join(", ")}`
            : `similar=${d.similarCount} message=${d.similarMessage ?? "none"}`,
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
    rule: "R6 (gate v7.1) explicit attribute mismatch now causes hard exclusion below 80% (replaces demotion)",
    async run() {
      const withAttr = await search("adidas leather sneaker");
      const target = "White Everyday Sneaker";
      const attrViolated = withAttr.similarProducts.find(
        (p) => p.name === target
      );
      const below = withAttr.similarProducts.filter(
        (p) => ratioOf(p) < 0.8
      );
      return {
        pass: !attrViolated && below.length === 0,
        detail: attrViolated
          ? `target survived at ratio ${ratioOf(attrViolated)}`
          : `target hard-excluded; ${withAttr.similarCount} similar remain (all >=80%)`,
      };
    },
  },
  {
    id: "SPEC-11",
    rule: "v7.1 80% structured-constraint gate: similar candidates must match >=80% of detected constraints (men Nike Black 41 Sneakers)",
    async run() {
      const d = await search("men Nike Black 41 Sneakers");
      const below = d.similarProducts.filter((p) => ratioOf(p) < 0.8);
      const jordan = d.similarProducts.find((p) =>
        p.name.includes("Air Jordan 1 Red And Black")
      );
      const puma = d.similarProducts.find((p) =>
        p.name.includes("Red Court Sneaker")
      );
      return {
        pass: below.length === 0 && Boolean(jordan) && !puma,
        detail: below.length > 0
          ? `below-80% similar: ${below.map((p) => p.name).join(", ")}`
          : `4/5 (Jordan) present=${
              Boolean(jordan)
            }, 2/5 Puma excluded=${!puma}, similar=${d.similarCount}`,
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
