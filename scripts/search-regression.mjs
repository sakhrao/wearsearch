const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

const CASES = [
  {
    q: "black tank top",
    exact: 4,
    similar: 3,
    struct: { category: "Tank Tops", color: "Black" },
    note: "core exact flow",
  },
  {
    q: "nike black tank top",
    exact: 1,
    similar: 6,
    struct: { brand: "Nike", category: "Tank Tops", color: "Black" },
    note: "brand+color+category combined",
  },
  {
    q: "white sneaker 41",
    exact: 2,
    similar: 7,
    struct: { category: "Sneakers", color: "White", size: "41" },
    note: "EU shoe size",
  },
  {
    q: "women jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "gender isolation",
  },
  {
    q: "leather shoes",
    exact: 12,
    similar: 15,
    struct: { category: "Shoes", attributes: ["Material:Leather"] },
    note: "material attribute",
  },
  {
    q: "slim fit black",
    exact: 5,
    similar: 30,
    struct: { color: "Black", attributes: ["Fit:Slim"] },
    note: "changed intentionally in 6.3: attribute match remains eligible as Similar despite color mismatch (no color penalty stack kills attr-only candidates)",
  },
  {
    q: "men jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "men isolation",
  },
  {
    q: "ladies jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'ladies' -> WOMEN hard filter (no men's leak in Exact or Similar)",
  },
  {
    q: "womens jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'womens' -> WOMEN hard filter",
  },
  {
    q: "women's jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: possessive form documents existing apostrophe tokenization path",
  },
  {
    q: "female jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: mirror case for existing 'female' word",
  },
  {
    q: "mens jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'mens' -> MEN hard filter (no women's leak in Exact or Similar)",
  },
  {
    q: "men's jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: possessive form documents existing apostrophe tokenization path",
  },
  {
    q: "male jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: mirror case for existing 'male' word",
  },
  {
    q: "gentlemen jeans",
    exact: 3,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'gentlemen' -> MEN hard filter",
  },
  {
    q: "women t-shirt",
    exact: 6,
    similar: 0,
    struct: { gender: "WOMEN", category: "T-Shirts" },
    note: "unisex included in women scope",
  },
  {
    q: "men tank top",
    exact: 5,
    similar: 0,
    struct: { gender: "MEN", category: "Tank Tops" },
    note: "unisex included in men scope",
  },
  {
    q: "women tank top",
    exact: 6,
    similar: 0,
    struct: { gender: "WOMEN", category: "Tank Tops" },
    note: "unisex included in women scope",
  },
  {
    q: "BLACK TANK TOP",
    exact: 4,
    similar: 3,
    note: "case-insensitive normalization",
  },
  {
    q: "black   tank   top",
    exact: 4,
    similar: 3,
    note: "multi-space normalization",
  },
  {
    q: "black tank-top",
    exact: 4,
    similar: 3,
    note: "changed intentionally in 6.2: hyphen-split tokenization treats it like 'black tank top'",
  },
  {
    q: "blue tank tops",
        exact: 0,
        similar: 7,
        struct: { category: "Tank Tops", color: "Blue" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — blue Jeans no longer enter via color alone",
  },
  {
    q: "h&m jeans",
        exact: 1,
        similar: 4,
        struct: { brand: "H&M", category: "Jeans" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — non-Jeans H&M items no longer enter via brand alone",
  },
  {
    q: "tops",
    exact: 40,
    similar: 0,
    struct: { category: "Tops" },
    note: "parent category hierarchy",
  },
  {
    q: "clothing",
    exact: 66,
    similar: 0,
    struct: { category: "Clothing" },
    note: "root category hierarchy",
  },
  {
    q: "bottoms",
    exact: 26,
    similar: 0,
    struct: { category: "Bottoms" },
    note: "mid-level hierarchy",
  },
  {
    q: "shoes",
    exact: 27,
    similar: 0,
    struct: { category: "Shoes" },
    note: "separate root branch",
  },
  {
    q: "sneaker 42",
    exact: 2,
    similar: 7,
    note: "similar item at score 0 boundary (score>=0 inclusion)",
  },
  {
    q: "size medium black tank top",
    exact: 3,
    similar: 4,
    struct: { color: "Black", size: "M" },
    note: "new in 6.5.2: 'medium' -> M intent; 3 black tanks stock M, Women Black Basic Tank is S-only so it lands in Similar",
  },
  {
    q: "extra small tank top",
    exact: 0,
    similar: 7,
    struct: { category: "Tank Tops", size: "XS" },
    note: "new in 6.5.2: 'extra small' -> XS; no tank stocks XS so honest Similar-only (mirrors XXL behavior)",
  },
  {
    q: "double extra large tank top",
    exact: 0,
    similar: 7,
    struct: { category: "Tank Tops", size: "XXL" },
    note: "new in 6.5.2: longest-phrase 'double extra large' -> XXL; no tank stocks it so honest Similar-only",
  },
  {
    q: "eu 41 sneakers",
    exact: 3,
    similar: 6,
    struct: { category: "Sneakers", size: "41" },
    note: "new in 6.5.2: numeric system prefix 'eu' stays inert, numeric size untouched by letter aliases",
  },
  {
    q: "tee",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.3: category synonym 'tee' -> T-Shirts structured intent",
  },
  {
    q: "tees",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.3: plural synonym 'tees' -> T-Shirts",
  },
  {
    q: "black tee",
        exact: 1,
        similar: 11,
        struct: { category: "T-Shirts", color: "Black" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — only in-subtree black tees remain",
  },
  {
    q: "white tee",
        exact: 2,
        similar: 10,
        struct: { category: "T-Shirts", color: "White" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — only in-subtree white tees remain in Similar",
  },
  {
    q: "trainer",
    exact: 9,
    similar: 0,
    struct: { category: "Sneakers" },
    note: "new in 6.5.3: 'trainer' -> Sneakers structured intent; counts from native-equivalent simulation",
  },
  {
    q: "trainers",
    exact: 9,
    similar: 0,
    struct: { category: "Sneakers" },
    note: "new in 6.5.3: British synonym 'trainers' -> Sneakers",
  },
  {
    q: "white trainers",
        exact: 4,
        similar: 5,
        struct: { category: "Sneakers", color: "White" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — white tees no longer enter Sneakers queries via color alone",
  },
  {
    q: "tshirt",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.5: compact spelling 'tshirt' -> T-Shirts (G8); mirrors native 't shirt'",
  },
  {
    q: "tshirts",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.5: compact plural spelling -> T-Shirts",
  },
  {
    q: "black tshirt",
        exact: 1,
        similar: 11,
        struct: { category: "T-Shirts", color: "Black" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — only in-subtree black tees remain",
  },
  {
    q: "tanktop",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.5: compact spelling 'tanktop' -> Tank Tops",
  },
  {
    q: "tanktops",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.5: compact plural spelling -> Tank Tops",
  },
  {
    q: "black tanktop",
    exact: 4,
    similar: 3,
    struct: { category: "Tank Tops", color: "Black" },
    note: "new in 6.5.5: compact spelling + color must equal native 'black tank top' result set",
  },
  {
    q: "women tshirts",
    exact: 6,
    similar: 0,
    struct: { category: "T-Shirts", gender: "WOMEN" },
    note: "new in 6.5.5: gender + compact spelling compose like native 'women t-shirt'",
  },
  {
    q: "tank",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: bare 'tank' promoted from lucky free-text hit to structured category intent",
  },
  {
    q: "tanks",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: 'tanks' -> Tank Tops structured intent",
  },
  {
    q: "black tank",
    exact: 4,
    similar: 3,
    struct: { category: "Tank Tops", color: "Black" },
    note: "new in 6.5.3: must equal 'black tank top' result set exactly",
  },
  {
    q: "tank top",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: native phrase regression guard while short alias exists",
  },
  {
    q: "tank tops",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: plural native phrase guard",
  },
  {
    q: "pants",
    exact: 0,
    similar: 0,
    note: "new in 6.5.3: unsupported category intent (no Bottoms-class stock beyond Jeans); honest empty, never Jeans Exact",
  },
  {
    q: "black pants",
    exact: 0,
    similar: 21,
    struct: { color: "Black" },
    note: "new in 6.5.3: unsupported intent gates Exact off (kills pre-spec misleading Exact x4); Similar keeps color-relevant candidates; counts match simulation proxy",
  },
  {
    q: "cargo pants",
    exact: 0,
    similar: 0,
    note: "new in 6.5.3: 'cargo' stays inert (no auto-attribute), unsupported intent -> honest empty",
  },
  {
    q: "jeans m",
    exact: 4,
    similar: 1,
    struct: { category: "Jeans", size: "M" },
    note: "clothing letter size",
  },
  {
    q: "tank top xl",
    exact: 0,
    similar: 7,
    struct: { category: "Tank Tops", size: "XL" },
    note: "size with no variants",
  },
  {
    q: "cotton tank top",
    exact: 5,
    similar: 2,
    struct: { category: "Tank Tops", attributes: ["Material:Cotton"] },
    note: "material attribute",
  },
  {
    q: "denim jeans",
    exact: 5,
    similar: 0,
    struct: { category: "Jeans", attributes: ["Material:Denim"] },
    note: "material attribute",
  },
  {
    q: "classic shoes",
    exact: 9,
    similar: 18,
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
    exact: 25,
    similar: 0,
    struct: { brand: "Zara" },
    note: "brand-only",
  },
  {
    q: "red tank top",
    exact: 1,
    similar: 6,
    struct: { category: "Tank Tops", color: "Red" },
    note: "unavailable color",
  },
  {
    q: "green shoes",
    exact: 2,
    similar: 25,
    struct: { category: "Shoes", color: "Green" },
    note: "unavailable color",
  },
  {
    q: "unisex t-shirt",
    exact: 2,
    similar: 0,
    struct: { gender: "UNISEX", category: "T-Shirts" },
    note: "strict unisex excludes MEN/WOMEN",
  },
  {
    q: "sleeveless top",
    exact: 7,
    similar: 33,
    struct: { category: "Tops", attributes: ["Sleeve:Sleeveless"] },
    note: "sleeve attribute + parent category",
  },
  {
    q: "round neck",
    exact: 19,
    similar: 0,
    struct: { attributes: ["Collar:Round Neck"] },
    note: "multi-word attribute value",
  },
  {
    q: "skinny jeans",
    exact: 3,
    similar: 2,
    struct: { category: "Jeans", attributes: ["Fit:Skinny"] },
    note: "fit attribute with one mismatch allowed",
  },
  {
    q: "straight jeans",
    exact: 2,
    similar: 3,
    struct: { category: "Jeans", attributes: ["Fit:Straight"] },
    note: "fit attribute with one mismatch allowed",
  },
  {
    q: "sport top",
    exact: 7,
    similar: 33,
    struct: { category: "Tops", attributes: ["Style:Sport"] },
    note: "style attribute broad similar set",
  },
  {
    q: "new balance sneaker",
    exact: 2,
    similar: 7,
    struct: { brand: "New Balance", category: "Sneakers" },
    note: "similar item at score 0 boundary (score>=0 inclusion)",
  },
  {
    q: "adidas",
    exact: 8,
    similar: 0,
    struct: { brand: "Adidas" },
    note: "brand across categories",
  },
  {
    q: "brown shoe",
    exact: 4,
    similar: 23,
    struct: { category: "Shoes", color: "Brown" },
    note: "singular form matches plural dictionary entry",
  },
  {
    q: "women sneakers",
    exact: 4,
    similar: 0,
    struct: { gender: "WOMEN", category: "Sneakers" },
    note: "plural category + gender scope",
  },
  {
    q: "women's black cotton tank top size S",
    exact: 1,
    similar: 4,
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
    similar: 4,
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
    similar: 19,
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
    similar: 5,
    struct: { brand: "Zara", category: "Tank Tops", color: "Black" },
    note: "new in 6.2: hyphenated input with brand masking",
  },
  {
    q: "classic leather shoes",
    exact: 7,
    similar: 20,
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
  {
    q: "shirt",
    exact: 0,
    similar: 40,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "T-Shirts", "Tank Tops"],
    },
    note: "updated in 6.7.2 INTENTIONALLY: empty-category sibling substitution fills the dead end with constraint-clean siblings (no color/gender/attr intent here -> all 7)",
  },
  {
    q: "shirts",
    exact: 0,
    similar: 40,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "T-Shirts", "Tank Tops"],
    },
    note: "updated in 6.7.2 INTENTIONALLY: same detection as 'shirt', sibling substitution applies identically",
  },
  {
    q: "black shirt",
    exact: 0,
    similar: 9,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "T-Shirts", "Tank Tops"],
    },
    note: "new in 6.7.1: fallback Similar must stay exactly as before while metadata explains requested category",
  },
  {
    q: "white shirt",
    exact: 0,
    similar: 6,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "T-Shirts", "Tank Tops"],
    },
    note: "updated intentionally in 6.8: cross-branch leak fix excludes Sneakers from Similar; only in-subtree white tees remain",
  },
  {
    q: "men shirt",
    exact: 0,
    similar: 23,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "T-Shirts", "Tank Tops"],
    },
    note: "updated in 6.7.2 INTENTIONALLY: sibling substitution preserves explicit gender constraint (MEN-compatible siblings only)",
  },
  {
    q: "classic shirt",
    exact: 0,
    similar: 2,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "T-Shirts", "Tank Tops"],
    },
    note: "new in 6.7.1: attribute+empty category still metadata-only",
  },
  {
    q: "t-shirt",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    status: {
      requested: "T-Shirts",
      productCount: 12,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "Shirts", "Tank Tops"],
    },
    note: "new in 6.7.1: stocked category reports its own count and taxonomy siblings",
  },
  {
    q: "tank top",
    exact: 7,
    similar: 0,
    struct: { category: "Tank Tops" },
    status: {
      requested: "Tank Tops",
      productCount: 7,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Polos", "Shirts", "T-Shirts"],
    },
    note: "new in 6.7.1: sibling list includes empty Shirts too - data first, merchandising later",
  },
  {
    q: "jeans",
    exact: 5,
    similar: 0,
    struct: { category: "Jeans" },
    status: {
      requested: "Jeans",
      productCount: 5,
      siblings: ["Chinos", "Joggers", "Leggings", "Trousers"],
    },
    note: "new in 6.7.1: only child under Bottoms -> empty siblings",
  },
  {
    q: "shoes",
    exact: 27,
    similar: 0,
    struct: { category: "Shoes" },
    status: {
      requested: "Shoes",
      productCount: 27,
      siblings: [],
    },
    note: "new in 6.7.1: top-level node has no parent hence no siblings; count = subtree products",
  },
  {
    q: "nike",
    exact: 10,
    similar: 0,
    status: null,
    note: "new in 6.7.1: brand-only query has no detected category -> categoryStatus stays null",
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

  if ("status" in testCase) {
    const actual = data.categoryStatus ?? null;
    if (
      JSON.stringify(actual) !== JSON.stringify(testCase.status)
    ) {
      problems.push(
        `categoryStatus=${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.status)}`
      );
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
