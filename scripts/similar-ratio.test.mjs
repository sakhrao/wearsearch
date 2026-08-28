const API = process.env.SEARCH_API ?? "http://localhost:3000/api/search";

const KEYS = [
  "brand",
  "category",
  "color",
  "size",
  "gender",
  "budget",
  "attributes",
];

let failures = 0;
let checks = 0;

function check(condition, label) {
  checks++;
  if (condition) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`);
  }
}

function ratioOf(product) {
  const constraints = KEYS.filter(
    (key) => product.structuredMatches[key] !== null
  );
  const matched = KEYS.filter(
    (key) => product.structuredMatches[key] === true
  );
  if (constraints.length === 0) return null;
  return matched.length / constraints.length;
}

async function search(query) {
  const response = await fetch(
    `${API}?q=${encodeURIComponent(query)}`
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for "${query}"`);
  }
  const data = await response.json();
  if (!data.success) {
    throw new Error(`API error for "${query}"`);
  }
  return data;
}

const names = (products) => products.map((p) => p.name);

function isExact(data, productName) {
  return data.exactProducts.some((p) => p.name.includes(productName));
}

async function assertAllSimilarRatiosAtLeast80(query) {
  const data = await search(query);
  const products = data.similarProducts;
  let allOk = products.length > 0;
  let worst = null;
  for (const product of products) {
    const ratio = ratioOf(product);
    if (ratio === null || ratio < 0.8) {
      allOk = false;
      worst = `${product.name} @ ${(ratio * 100).toFixed(0)}%`;
      break;
    }
  }
  check(
    allOk,
    `"${query}": every similar product ratio >= 80%${
      worst ? ` (VIOLATION: ${worst})` : ""
    } (got ${products.length} similar)`
  );
}

console.log("\n== Case 1: men Nike Black 41 Sneakers (5 constraints) ==");
const case1 = await search("men Nike Black 41 Sneakers");
await assertAllSimilarRatiosAtLeast80("men Nike Black 41 Sneakers");

const similar1 = names(case1.similarProducts);
check(
  similar1.some((n) => n.includes("Air Jordan 1 Red And Black")),
  `80% boundary (4/5): "Nike Air Jordan 1 Red And Black" IS included`
);
check(
  !similar1.some((n) => n.includes("Men Black Training T-Shirt")),
  `<80% (3/5): "Men Black Training T-Shirt" is EXCLUDED`
);
check(
  !similar1.some((n) => n.includes("Red Court Sneaker")),
  `<80% (2/5): "Puma Red Court Sneaker" is EXCLUDED`
);

console.log("\n== Case 2: 100% constraint match moves to Exact now that 'hoodie' is a real category ==");
const case2 = await search("men black sneaker nike 42 hoodie");
check(
  isExact(case2, "Black Runner Sneaker"),
  `100% product "Nike Black Runner Sneaker" is Exact (formerly Similar under unsupported-hoodie intent; got ${isExact(case2, "Black Runner Sneaker") ? "exact" : "not exact"})`
);
const runner2 = case2.similarProducts.filter((p) =>
  p.name.includes("Black Runner Sneaker")
);
check(
  runner2.length === 0,
  `"Nike Black Runner Sneaker" no longer appears in Similar (deduped into Exact; got ${runner2.length})`
);
await assertAllSimilarRatiosAtLeast80("men black sneaker nike 42 hoodie");

console.log("\n== Case 3: no product reaches 80% => empty Similar + message ==");
const case3 = await search("men Unbranded Purple 41 Sneakers");
check(
  case3.similarCount === 0,
  `similarCount is 0 for an impossible query (got ${case3.similarCount})`
);
check(
  typeof case3.similarMessage === "string" &&
    case3.similarMessage.includes("80%") &&
    case3.similarMessage.includes("your preferences"),
  `similarMessage is user-friendly and mentions 80% (got "${case3.similarMessage}")`
);

console.log("\n== Case 4: Exact is unchanged by the gate ==");
const blackShoes = await search("black shoes");
check(
  blackShoes.exactCount === 29,
  `"black shoes" exactCount == 29 (golden; re-based P1/P4: the Black Square Neck T-Shirt is no longer a Black shoe)`
);
const nike = await search("nike");
check(
  nike.exactCount === 10,
  `"nike" exactCount == 10 (golden)`
);
const case1Repeat = await search("men Nike Black 41 Sneakers");
check(
  JSON.stringify(case1Repeat.exactProducts.map((p) => p.id)) ===
    JSON.stringify(case1.exactProducts.map((p) => p.id)),
  `"men Nike Black 41 Sneakers" exactProduct set identical across calls`
);

console.log(`\n=== RESULT: ${checks - failures}/${checks} passed ===`);
if (failures > 0) {
  process.exit(1);
}