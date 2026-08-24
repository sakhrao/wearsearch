const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

const CASES = [
  {
    q: "black tank top",
    exact: 4,
    similar: 0,
    struct: { category: "Tank Tops", color: "Black" },
    note: "core exact flow",
  },
  {
    q: "nike black tank top",
    exact: 1,
    similar: 3,
    struct: { brand: "Nike", category: "Tank Tops", color: "Black" },
    note: "brand+color+category combined",
  },
  {
    q: "white sneaker 41",
    exact: 2,
    similar: 0,
    struct: { category: "Sneakers", color: "White", size: "41" },
    note: "EU shoe size",
  },
  {
    q: "women jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "gender isolation",
  },
  {
    q: "leather shoes",
    exact: 2,
    similar: 1,
    struct: { category: "Shoes", attributes: ["Material:Leather"] },
    note: "material attribute",
  },
  {
    q: "slim fit black",
    exact: 2,
    similar: 3,
    struct: { color: "Black", attributes: ["Fit:Slim"] },
    note: "changed intentionally in 6.3: attribute match remains eligible as Similar despite color mismatch (no color penalty stack kills attr-only candidates)",
  },
  {
    q: "men jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "men isolation",
  },
  {
    q: "women t-shirt",
    exact: 2,
    similar: 0,
    struct: { gender: "WOMEN", category: "T-Shirts" },
    note: "unisex included in women scope",
  },
  {
    q: "men tank top",
    exact: 3,
    similar: 0,
    struct: { gender: "MEN", category: "Tank Tops" },
    note: "unisex included in men scope",
  },
  {
    q: "women tank top",
    exact: 4,
    similar: 0,
    struct: { gender: "WOMEN", category: "Tank Tops" },
    note: "unisex included in women scope",
  },
  {
    q: "BLACK TANK TOP",
    exact: 4,
    similar: 0,
    note: "case-insensitive normalization",
  },
  {
    q: "black   tank   top",
    exact: 4,
    similar: 0,
    note: "multi-space normalization",
  },
  {
    q: "black tank-top",
    exact: 4,
    similar: 0,
    note: "changed intentionally in 6.2: hyphen-split tokenization treats it like 'black tank top'",
  },
  {
    q: "blue tank tops",
    exact: 0,
    similar: 6,
    struct: { category: "Tank Tops", color: "Blue" },
    note: "changed intentionally in 6.3: catalog has no blue tank top; category coherence is preserved (on-category tanks first, cross-category blue items demoted by Coherence Factor)",
  },
  {
    q: "h&m jeans",
    exact: 0,
    similar: 5,
    struct: { brand: "H&M", category: "Jeans" },
    note: "changed intentionally in 6.2: brand span masked, stray 'm' no longer parsed as Size M; changed intentionally in 6.3: improved category coherence (jeans return at 320 above brand-only strays at 10)",
  },
  {
    q: "tops",
    exact: 7,
    similar: 0,
    struct: { category: "Tops" },
    note: "parent category hierarchy",
  },
  {
    q: "clothing",
    exact: 9,
    similar: 0,
    struct: { category: "Clothing" },
    note: "root category hierarchy",
  },
  {
    q: "bottoms",
    exact: 2,
    similar: 0,
    struct: { category: "Bottoms" },
    note: "mid-level hierarchy",
  },
  {
    q: "shoes",
    exact: 3,
    similar: 0,
    struct: { category: "Shoes" },
    note: "separate root branch",
  },
  {
    q: "sneaker 42",
    exact: 0,
    similar: 2,
    struct: { category: "Sneakers", size: "42" },
    note: "existing size with no stock -> similar fallback",
  },
  {
    q: "jeans m",
    exact: 2,
    similar: 0,
    struct: { category: "Jeans", size: "M" },
    note: "clothing letter size",
  },
  {
    q: "tank top xl",
    exact: 0,
    similar: 4,
    struct: { category: "Tank Tops", size: "XL" },
    note: "size with no variants",
  },
  {
    q: "cotton tank top",
    exact: 4,
    similar: 0,
    struct: { category: "Tank Tops", attributes: ["Material:Cotton"] },
    note: "material attribute",
  },
  {
    q: "denim jeans",
    exact: 2,
    similar: 0,
    struct: { category: "Jeans", attributes: ["Material:Denim"] },
    note: "material attribute",
  },
  {
    q: "classic shoes",
    exact: 3,
    similar: 0,
    struct: { category: "Shoes", attributes: ["Style:Classic"] },
    note: "style attribute",
  },
  {
    q: "",
    exact: 0,
    similar: 0,
    note: "empty query",
  },
  {
    q: "   ",
    exact: 0,
    similar: 0,
    note: "whitespace-only query",
  },
  {
    q: "x",
    exact: 0,
    similar: 0,
    note: "single char below min word length",
  },
  {
    q: "n/a",
    exact: 0,
    similar: 0,
    note: "n/a must produce no signal",
  },
  {
    q: "!!! ???",
    exact: 0,
    similar: 0,
    note: "punctuation-only evaporates",
  },
  {
    q: "xyzqqq",
    exact: 0,
    similar: 0,
    note: "gibberish",
  },
  {
    q: "123456",
    exact: 0,
    similar: 0,
    note: "numeric noise",
  },
  {
    q: "zz ".repeat(50),
    exact: 0,
    similar: 0,
    note: "long repeated noise",
  },
  {
    q: "zara",
    exact: 4,
    similar: 0,
    struct: { brand: "Zara" },
    note: "brand-only",
  },
  {
    q: "red tank top",
    exact: 0,
    similar: 4,
    struct: { category: "Tank Tops", color: "Red" },
    note: "unavailable color",
  },
  {
    q: "green shoes",
    exact: 0,
    similar: 3,
    struct: { category: "Shoes", color: "Green" },
    note: "unavailable color",
  },
  {
    q: "unisex t-shirt",
    exact: 1,
    similar: 0,
    struct: { gender: "UNISEX", category: "T-Shirts" },
    note: "strict unisex excludes MEN/WOMEN",
  },
  {
    q: "sleeveless top",
    exact: 4,
    similar: 3,
    struct: { category: "Tops", attributes: ["Sleeve:Sleeveless"] },
    note: "sleeve attribute + parent category",
  },
  {
    q: "round neck",
    exact: 7,
    similar: 0,
    struct: { attributes: ["Collar:Round Neck"] },
    note: "multi-word attribute value",
  },
  {
    q: "skinny jeans",
    exact: 1,
    similar: 1,
    struct: { category: "Jeans", attributes: ["Fit:Skinny"] },
    note: "fit attribute with one mismatch allowed",
  },
  {
    q: "straight jeans",
    exact: 1,
    similar: 1,
    struct: { category: "Jeans", attributes: ["Fit:Straight"] },
    note: "fit attribute with one mismatch allowed",
  },
  {
    q: "sport top",
    exact: 1,
    similar: 6,
    struct: { category: "Tops", attributes: ["Style:Sport"] },
    note: "style attribute broad similar set",
  },
  {
    q: "new balance sneaker",
    exact: 1,
    similar: 1,
    struct: { brand: "New Balance", category: "Sneakers" },
    note: "similar item at score 0 boundary (score>=0 inclusion)",
  },
  {
    q: "adidas",
    exact: 2,
    similar: 0,
    struct: { brand: "Adidas" },
    note: "brand across categories",
  },
  {
    q: "brown shoe",
    exact: 1,
    similar: 2,
    struct: { category: "Shoes", color: "Brown" },
    note: "singular form matches plural dictionary entry",
  },
  {
    q: "women sneakers",
    exact: 2,
    similar: 0,
    struct: { gender: "WOMEN", category: "Sneakers" },
    note: "plural category + gender scope",
  },
  {
    q: "women's black cotton tank top size S",
    exact: 1,
    similar: 3,
    struct: {
      gender: "WOMEN",
      category: "Tank Tops",
      color: "Black",
      size: "S",
      attributes: ["Material:Cotton"],
    },
    note: "new in 6.2: possessive + 'size' keyword + full structured parse",
  },
  {
    q: "WOMEN'S  Black COTTON Tank-Top  SIZE s",
    exact: 1,
    similar: 3,
    struct: {
      gender: "WOMEN",
      category: "Tank Tops",
      color: "Black",
      size: "S",
      attributes: ["Material:Cotton"],
    },
    note: "new in 6.2: chaotic casing/spacing/hyphen normalizes to same result",
  },
  {
    q: "black nike hoodie for men",
    exact: 0,
    similar: 3,
    struct: { brand: "Nike", color: "Black", gender: "MEN" },
    note: "changed intentionally in 6.4.2: unsupported category intent (hoodie) makes Exact impossible; structured constraints still produce Similar candidates",
  },
  {
    q: "men hoodie",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN" },
    note: "changed intentionally in 6.2: unknown word with gender-only structure falls back to similar, never blanket-exact; changed intentionally in 6.3: structural-intent admission prevents gender-only similarity (no hoodie in catalog, so honest empty result)",
  },
  {
    q: "zara black tank-top",
    exact: 2,
    similar: 2,
    struct: { brand: "Zara", category: "Tank Tops", color: "Black" },
    note: "new in 6.2: hyphenated input with brand masking",
  },
  {
    q: "classic leather shoes",
    exact: 2,
    similar: 1,
    struct: {
      category: "Shoes",
      attributes: ["Style:Classic", "Material:Leather"],
    },
    note: "new in 6.2: two simultaneous attribute detections with masking",
  },
  {
    q: "size",
    exact: 0,
    similar: 0,
    note: "new in 6.2: structural stopword alone produces no signal",
  },
  {
    q: "for",
    exact: 0,
    similar: 0,
    note: "new in 6.2: structural stopword alone produces no signal",
  },
];

const GENDER_COMPATIBILITY = {
  MEN: ["MEN", "UNISEX"],
  WOMEN: ["WOMEN", "UNISEX"],
  UNISEX: ["UNISEX"],
};

function attrsSignature(structuredQuery) {
  return structuredQuery.attributes
    .map((a) => `${a.attributeName}:${a.value}`)
    .sort()
    .join("|");
}

async function runCase(client, testCase) {
  const problems = [];
  const res = await client.fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(testCase.q)}`
  );

  if (res.status !== 200) {
    problems.push(`HTTP ${res.status}, expected 200`);
    return problems;
  }

  const data = await res.json();

  if (data.success !== true) {
    problems.push(`success=${data.success}, expected true`);
    return problems;
  }

  if (!Array.isArray(data.exactProducts)) {
    problems.push("exactProducts missing/not array");
    return problems;
  }

  if (!Array.isArray(data.similarProducts)) {
    problems.push("similarProducts missing/not array");
    return problems;
  }

  if (data.exactCount !== data.exactProducts.length) {
    problems.push(
      `exactCount(${data.exactCount}) != exactProducts.length(${data.exactProducts.length})`
    );
  }

  if (data.similarCount !== data.similarProducts.length) {
    problems.push(
      `similarCount(${data.similarCount}) != similarProducts.length(${data.similarProducts.length})`
    );
  }

  if (data.query !== testCase.q.trim()) {
    problems.push(`echoed query "${data.query}" != "${testCase.q.trim()}"`);
  }

  if (data.exactCount !== testCase.exact) {
    problems.push(`exactCount=${data.exactCount}, expected ${testCase.exact}`);
  }

  if (data.similarCount !== testCase.similar) {
    problems.push(
      `similarCount=${data.similarCount}, expected ${testCase.similar}`
    );
  }

  if (testCase.struct) {
    for (const field of ["brand", "category", "color", "size", "gender"]) {
      if (field in testCase.struct) {
        const actual = data.structuredQuery[field];
        if (actual !== testCase.struct[field]) {
          problems.push(
            `structured.${field}=${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.struct[field])}`
          );
        }
      }
    }

    if ("attributes" in testCase.struct) {
      const actualSig = attrsSignature(data.structuredQuery);
      const expectedSig = [...testCase.struct.attributes].sort().join("|");
      if (actualSig !== expectedSig) {
        problems.push(
          `structured.attributes=[${actualSig}], expected [${expectedSig}]`
        );
      }
    }
  }

  const allProducts = [...data.exactProducts, ...data.similarProducts];

  for (const product of allProducts) {
    if (typeof product.score !== "number" || Number.isNaN(product.score)) {
      problems.push(`${product.name}: invalid score ${product.score}`);
      break;
    }

    if (product.score < 0) {
      problems.push(`${product.name}: negative score ${product.score}`);
      break;
    }
  }

  for (let i = 1; i < data.exactProducts.length; i++) {
    if (
      data.exactProducts[i - 1].score < data.exactProducts[i].score
    ) {
      problems.push("exact results not sorted by score descending");
      break;
    }
  }

  for (let i = 1; i < data.similarProducts.length; i++) {
    if (
      data.similarProducts[i - 1].score < data.similarProducts[i].score
    ) {
      problems.push("similar results not sorted by score descending");
      break;
    }
  }

  const exactIds = new Set(data.exactProducts.map((p) => p.id));

  for (const product of data.similarProducts) {
    if (exactIds.has(product.id)) {
      problems.push(`${product.name}: appears in both exact and similar`);
      break;
    }
  }

  const requestedGender = data.structuredQuery.gender;

  if (requestedGender && GENDER_COMPATIBILITY[requestedGender]) {
    const allowed = GENDER_COMPATIBILITY[requestedGender];

    for (const product of allProducts) {
      if (!allowed.includes(product.gender)) {
        problems.push(
          `${product.name}: gender ${product.gender} leaks into ${requestedGender} search`
        );
        break;
      }
    }
  }

  for (const product of data.exactProducts) {
    if (product.exactMatch !== true) {
      problems.push(`${product.name}: exact flag not true`);
      break;
    }
  }

  return problems;
}

function shortLabel(q) {
  const trimmed = q.replace(/\s+/g, " ").trim();
  const visible =
    trimmed.length > 24 ? `${trimmed.slice(0, 21)}...` : trimmed || "<empty>";
  return JSON.stringify(visible);
}

async function main() {
  console.log(`Search Regression Suite`);
  console.log(`Target: ${BASE_URL}/api/search`);
  console.log(`Cases: ${CASES.length}\n`);

  let client;

  try {
    await fetch(`${BASE_URL}/api/search?q=ping`, { signal: AbortSignal.timeout(10000) });
    client = { fetch };
  } catch (error) {
    console.error(`FAIL: dev server unreachable at ${BASE_URL}`);
    console.error(`Start it first: npm run dev`);
    process.exit(1);
  }

  const failures = [];
  let passed = 0;

  for (let i = 0; i < CASES.length; i++) {
    const testCase = CASES[i];
    const label = `[${String(i + 1).padStart(2, "0")}] ${shortLabel(testCase.q)}`;

    try {
      const problems = await runCase(client, testCase);

      if (problems.length === 0) {
        passed++;
        console.log(`PASS ${label} (${testCase.exact}/${testCase.similar})`);
      } else {
        failures.push({ label, q: testCase.q, problems });
        console.log(`FAIL ${label}`);
        for (const problem of problems) {
          console.log(`       - ${problem}`);
        }
      }
    } catch (error) {
      failures.push({ label, q: testCase.q, problems: [error.message] });
      console.log(`FAIL ${label}`);
      console.log(`       - request error: ${error.message}`);
    }
  }

  console.log(`\n================ RESULT ================`);
  console.log(`${passed}/${CASES.length} passed`);

  if (failures.length > 0) {
    console.log(`\nFailed cases:`);
    for (const failure of failures) {
      console.log(`  ${failure.label}`);
      for (const problem of failure.problems) {
        console.log(`    - ${problem}`);
      }
    }
    process.exit(1);
  }
}

main();
