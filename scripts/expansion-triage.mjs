const BASE_URL =
  process.env.BASE_URL ?? "http://localhost:3000";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("./search-regression.mjs", import.meta.url),
  "utf8"
);
const caseRe =
  /q:\s*"((?:[^"\\]|\\.)*)",\s*\n\s*exact:\s*(\d+),\s*\n\s*similar:\s*(\d+)/g;
const PINS = [];
let m;
while ((m = caseRe.exec(src)) !== null) {
  PINS.push({
    q: JSON.parse(`"${m[1]}"`),
    exact: Number(m[2]),
    similar: Number(m[3]),
  });
}

const SUBTREE = {
  Clothing: [
    "Clothing",
    "Tops",
    "Shirts",
    "T-Shirts",
    "Tank Tops",
    "Polos",
    "Blouses",
    "Cardigans",
    "Bottoms",
    "Jeans",
    "Chinos",
    "Trousers",
    "Leggings",
    "Joggers",
  ],
  Tops: [
    "Tops",
    "Shirts",
    "T-Shirts",
    "Tank Tops",
    "Polos",
    "Blouses",
    "Cardigans",
    "Button-Ups",
  ],
  Bottoms: [
    "Bottoms",
    "Jeans",
    "Chinos",
    "Trousers",
    "Leggings",
    "Joggers",
  ],
  Shirts: ["Shirts"],
  "T-Shirts": ["T-Shirts"],
  "Tank Tops": ["Tank Tops"],
  Polos: ["Polos"],
  Blouses: ["Blouses"],
  Cardigans: ["Cardigans"],
  Jeans: ["Jeans"],
  Chinos: ["Chinos"],
  Trousers: ["Trousers"],
  Leggings: ["Leggings"],
  Joggers: ["Joggers"],
  Shoes: [
    "Shoes",
    "Sneakers",
    "Formal Shoes",
    "Boots",
    "Loafers",
    "Sandals",
    "Heels",
  ],
  Sneakers: ["Sneakers"],
  "Formal Shoes": ["Formal Shoes"],
  Boots: ["Boots"],
  Loafers: ["Loafers"],
  Sandals: ["Sandals"],
  Heels: ["Heels"],
};

function subtreeOf(node) {
  return new Set(SUBTREE[node] ?? [node]);
}

async function search(q) {
  const r = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(30000) }
  );
  return await r.json();
}

let grew = 0,
  same = 0,
  shrank = 0,
  leaks = 0;
const problems = [];

for (const pin of PINS) {
  const data = await search(pin.q);
  const s = data.structuredQuery;
  const cs = data.categoryStatus;

  const oldTotal = pin.exact + pin.similar;
  const newTotal =
    data.exactCount + data.similarCount;

  if (newTotal < oldTotal) {
    shrank++;
    problems.push(
      `[SHRANK] "${pin.q}" ${pin.exact}/${pin.similar} -> ${data.exactCount}/${data.similarCount}`
    );
    continue;
  }
  if (newTotal === oldTotal) same++;
  else grew++;

  const emptyNode =
    !!cs && cs.productCount === 0;
  const siblings = new Set(cs?.siblings ?? []);
  const scope =
    s.category && !emptyNode
      ? subtreeOf(s.category)
      : null;

  for (const p of data.similarProducts) {
    const cat = p.category?.name ?? "";
    const ok =
      !scope ||
      scope.has(cat) ||
      (emptyNode && siblings.has(cat));
    if (!ok) {
      leaks++;
      problems.push(
        `[SCOPE-LEAK] "${pin.q}" req=[${s.category}] leaks "${p.name}" [${cat}]`
      );
    }
    if (
      (s.gender === "MEN" &&
        p.gender === "WOMEN") ||
      (s.gender === "WOMEN" &&
        p.gender === "MEN")
    ) {
      leaks++;
      problems.push(
        `[GENDER-LEAK] "${pin.q}" "${p.name}"`
      );
    }
  }
}

console.log("=== TRIAGE v2 ===");
console.log(
  `grew=${grew} same=${same} shrank=${shrank} realLeaks=${leaks}`
);
console.log("");
for (const p of problems) console.log(p);
if (problems.length === 0)
  console.log("NO INVARIANT VIOLATIONS.");
