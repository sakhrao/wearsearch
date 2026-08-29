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
    `${API}?q=${encodeURIComponent(query)}&debug=1`
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

console.log("\n== Case 2: 100% constraint match (PR2-F1: demo product excluded, honest empty exact) ==");
const case2 = await search("men black sneaker nike 42 hoodie");
check(
  case2.exactCount === 0,
  `PR2-F1 re-based: the only 100%-match candidate was the demo "Nike Black Runner Sneaker" (no real product page) -> honest empty exact; got ${case2.exactCount}`
);
check(
  !isExact(case2, "Black Runner Sneaker"),
  `demo/placeholder "Nike Black Runner Sneaker" is not Exact (F1 hasRealPage filter); got ${isExact(case2, "Black Runner Sneaker") ? "exact" : "absent"}`
);
check(
  case2.similarProducts.filter((p) =>
    p.name.includes("Black Runner Sneaker")
  ).length === 0,
  `demo "Nike Black Runner Sneaker" absent from Similar as well (filtered out of the serialized set)`
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

console.log("\n== Case 4: Exact is unchanged by the gate (PR2-F1 demo-free counts) ==");
const blackShoes = await search("black shoes");
check(
  blackShoes.exactCount === 23,
  `"black shoes" exactCount == 23 (PR2-F1: 5 demo shoes excluded; F8-A: Black matches via AVAILABLE variants only -> 24->23)`
);
const nike = await search("nike");
check(
  nike.exactCount === 1,
  `"nike" exactCount == 1 (PR2-F1 re-based: 9 of 10 Nike items were demo/placeholder; sole real = Nike Air Jordan 1 Red And Black)`
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