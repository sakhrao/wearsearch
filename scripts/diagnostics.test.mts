import {
  buildSearchDiagnostics,
  type DiagStrictVector,
  type SearchDiagnosticsContext,
} from "../src/lib/search-diagnostics";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const SEARCH = "http://localhost:3000/api/search";

async function search(q: string) {
  const res = await fetch(`${SEARCH}?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ============ UNIT: buildSearchDiagnostics (pure) ============ */

const V = (partial: Partial<DiagStrictVector> & {
  hasAnySize: boolean;
}): DiagStrictVector => ({
  brand: null,
  category: null,
  color: null,
  size: null,
  gender: null,
  budget: null,
  attributes: null,
  ...partial,
});

function ctx(partial: Partial<SearchDiagnosticsContext>): SearchDiagnosticsContext {
  return {
    categoryClause: "",
    requestedCategoryIsEmpty: false,
    detected: {
      brand: null,
      category: null,
      colors: [],
      size: null,
      gender: null,
      hasBudget: false,
      budgetMin: null,
      budgetMax: null,
      attributes: [],
    },
    unsupportedIntentWords: [],
    presence: {
      category: true,
      brand: true,
      color: true,
      size: true,
      gender: true,
      budget: true,
      attributes: true,
    },
    scopedVectors: [],
    allVectors: [],
    ...partial,
  };
}

{
  // U1: A - scoped absence of a size that exists elsewhere in the catalog
  const c = ctx({
    detected: { ...ctx({}).detected, size: "45" },
    presence: { ...ctx({}).presence, size: false },
    allVectors: [V({ size: true, hasAnySize: true })],
    scopedVectors: [
      V({ size: false, hasAnySize: true }),
      V({ size: false, hasAnySize: true }),
    ],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U1 A-scoped absent size names size and avoids combination/C messages",
    msgs.some((m) => m.includes("Size 45") && m.includes("unavailable")) &&
      !msgs.some((m) => m.includes("carry no size information")) &&
      !msgs.some((m) => m.includes("exist individually")),
    msgs.join(" | ")
  );
}

{
  // U2: A - size absent from the entire catalog
  const c = ctx({
    detected: { ...ctx({}).detected, size: "46" },
    presence: { ...ctx({}).presence, size: false },
    allVectors: [V({ size: false, hasAnySize: true })],
    scopedVectors: [V({ size: false, hasAnySize: true })],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U2 A-global absent size says it is entirely unavailable",
    msgs.some(
      (m) => m.includes("Size 46") && m.includes("entirely unavailable")
    ),
    msgs.join(" | ")
  );
}

{
  // U3: C - matching products carry no size data at all
  const c = ctx({
    detected: {
      ...ctx({}).detected,
      brand: "Off White",
      category: "Sneakers",
      size: "45",
    },
    presence: {
      ...ctx({}).presence,
      brand: true,
      category: true,
      size: false,
    },
    allVectors: [V({ size: true, hasAnySize: true })],
    scopedVectors: [
      V({ brand: true, category: true, size: false, hasAnySize: false }),
      V({ brand: true, category: true, size: false, hasAnySize: false }),
    ],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U3 missing size data is reported as unconfirmable, never as absent",
    msgs.some(
      (m) => m.includes("Size 45") && m.includes("carry no size information")
    ) &&
      !msgs.some((m) => m.includes("unavailable")),
    msgs.join(" | ")
  );
}

{
  // U4: B - every constraint individually present, no full combination
  const c = ctx({
    detected: {
      ...ctx({}).detected,
      brand: "Nike",
      category: "Sneakers",
      colors: ["Black"],
      size: "41",
      gender: "MEN",
    },
    presence: { ...ctx({}).presence },
    scopedVectors: [
      V({ brand: true, category: true, color: true, size: false, gender: true, hasAnySize: true }),
      V({ brand: true, category: true, color: true, size: false, gender: true, hasAnySize: true }),
      V({ brand: true, category: true, color: false, size: true, gender: true, hasAnySize: true }),
    ],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U4 combination conflict names individually-present constraints, no false single constraint",
    msgs.some(
      (m) =>
        m.includes("exist individually") &&
        m.includes("Nike") &&
        m.includes("Sneakers") &&
        m.includes("Black") &&
        m.includes("Size 41") &&
        m.includes("Men")
    ) &&
      !msgs.some((m) => m.includes("are currently available")) &&
      !msgs.some((m) => m.includes("unavailable")),
    msgs.join(" | ")
  );
}

{
  // U5: combination conflict with exactly one removable constraint names it
  const c = ctx({
    detected: {
      ...ctx({}).detected,
      brand: "Nike",
      category: "Sneakers",
      colors: ["Black"],
      size: "41",
    },
    presence: { ...ctx({}).presence },
    scopedVectors: [
      V({ brand: true, category: true, color: true, size: false, hasAnySize: true }),
      V({ brand: true, category: true, color: true, size: false, hasAnySize: true }),
      V({ brand: true, category: true, color: true, size: false, hasAnySize: true }),
    ],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U5 combination-conflict hint names the single removable constraint",
    msgs.some(
      (m) =>
        m.includes("exist individually") &&
        m.includes("Removing Size 41 would find matching products")
    ),
    msgs.join(" | ")
  );
}

{
  // U6: no false combination message when a full combination exists
  const c = ctx({
    detected: { ...ctx({}).detected, size: "41" },
    scopedVectors: [V({ size: true, hasAnySize: true })],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U6 full combination present -> no combination/absence message",
    !msgs.some((m) => m.includes("exist individually")) &&
      !msgs.some((m) => m.includes("Size 41")),
    msgs.join(" | ")
  );
}

{
  // U7: a single genuinely missing constraint keeps its own message, no combination claim
  const c = ctx({
    detected: {
      ...ctx({}).detected,
      brand: "Nike",
      category: "Sneakers",
      colors: ["Black"],
      size: "41",
    },
    presence: { ...ctx({}).presence, brand: false },
    scopedVectors: [
      V({ brand: false, category: true, color: true, size: true, hasAnySize: true }),
    ],
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U7 missing single constraint -> per-constraint message, no combination claim",
    msgs.some((m) => m.includes("No Nike products are currently available")) &&
      !msgs.some((m) => m.includes("exist individually")),
    msgs.join(" | ")
  );
}

{
  // U8: empty category reports the category, nothing else
  const c = ctx({
    requestedCategoryIsEmpty: true,
    detected: { ...ctx({}).detected, category: "Hoodies" },
  });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U8 empty category keeps its single message",
    msgs.some((m) => m.includes("currently has no products")) &&
      msgs.length === 2,
    msgs.join(" | ")
  );
}

{
  // U9: unsupported intent word message is preserved
  const c = ctx({ unsupportedIntentWords: ["suit"] });
  const msgs = buildSearchDiagnostics(c);
  check(
    "U9 unsupported word keeps its message",
    msgs.some((m) => m.includes('No products in the catalog for "suit"')),
    msgs.join(" | ")
  );
}

/* ============ INTEGRATION (live API, evidence pinned) ============ */

const bQuery = "men Nike Black 41 Sneakers";

{
  const r1 = await search(bQuery);
  const r2 = await search(bQuery);
  const ids1 = (r1.similarProducts ?? []).map((p: { id: string }) => p.id);
  const ids2 = (r2.similarProducts ?? []).map((p: { id: string }) => p.id);
  check(
    "I1 B combination query: exact=0, similar=1 (PR2-F1 demo-free), deterministic membership+order",
    r1.exactCount === 0 &&
      r1.similarCount === 1 &&
      ids1.length === ids2.length &&
      ids1.every((id: string, i: number) => id === ids2[i]) &&
      ids1.join(",") === "cmt7zyvxd000alc7k93ozhd5f",
    `ids=${ids1.join(",")}`
  );
  const diag = r1.diagnostics ?? [];
  check(
    "I2 B combination query diagnoses the combination, not a missing constraint",
    diag.some((m: string) => m.includes("exist individually")) &&
      diag.some((m: string) => m.includes("Size 41")) &&
      diag.some((m: string) => m.includes("Removing Size 41")) &&
      !diag.some((m: string) => m.includes("unavailable")) &&
      !diag.some((m: string) => m.includes("carry no size information")),
    diag.join(" | ")
  );
}

{
  const r = await search("size 45 sneakers");
  const diag = r.diagnostics ?? [];
  check(
    "I3 A absent-size diagnostic (scoped) is precise and non-combination",
    r.exactCount === 0 &&
      diag.some(
        (m: string) =>
          m.includes("Size 45") && m.includes("unavailable in the catalog")
      ) &&
      !diag.some((m: string) => m.includes("exist individually")),
    `${r.exactCount} | ${diag.join(" | ")}`
  );
}

{
  const r = await search("Off White sneakers size 45");
  const diag = r.diagnostics ?? [];
  check(
    "I4 C missing-size-data diagnostic, never claims absence",
    r.exactCount === 0 &&
      r.similarCount === 0 &&
      diag.some(
        (m: string) =>
          m.includes("Size 45") && m.includes("carry no size information")
      ) &&
      !diag.some((m: string) => m.includes("unavailable")) &&
      !diag.some((m: string) => m.includes("exist individually")),
    `${r.exactCount}/${r.similarCount} | ${diag.join(" | ")}`
  );
}

{
  const r = await search("clothing size 11");
  const diag = r.diagnostics ?? [];
  check(
    "I5 category-scoped absent size keeps the scoped A diagnostic",
    r.exactCount === 0 &&
      diag.some((m: string) => m.includes("Size 11") && m.includes("unavailable")),
    diag.join(" | ")
  );
}

{
  const r = await search("white sneakers");
  check(
    "I6 successful search produces no diagnostics",
    r.exactCount > 0 && (r.diagnostics ?? []).length === 0,
    `exact=${r.exactCount} diag=[${(r.diagnostics ?? []).join(" | ")}]`
  );
}

{
  const r = await search("sneakers size 41");
  check(
    "I7 size constraint satisfied by a product -> no diagnostics",
    r.exactCount > 0 && (r.diagnostics ?? []).length === 0,
    `exact=${r.exactCount} diag=[${(r.diagnostics ?? []).join(" | ")}]`
  );
}

{
  /* PR2-F2 re-based: 'hoodie' no longer probes an empty category (Hoodies
     is now stocked with 37 real products). Jumpers remains a genuinely
     empty category and keeps the empty-category diagnostic behaviour. */
  const r = await search("jumpers");
  const diag = r.diagnostics ?? [];
  check(
    "I8 empty-category diagnostic unchanged",
    r.exactCount === 0 &&
      diag.some((m: string) => m.includes("currently has no products")),
    diag.join(" | ")
  );
}

{
  const r = await search("suit");
  const diag = r.diagnostics ?? [];
  check(
    "I9 unsupported-word diagnostic unchanged",
    diag.some((m: string) => m.includes('No products in the catalog for "suit"')),
    diag.join(" | ")
  );
}

{
  const res = await fetch(`${SEARCH}?q=sneakers&priceMin=5&priceMax=10`);
  const budget = await res.json();
  const diag = budget.diagnostics ?? [];
  check(
    "I10 budget-constrained empty result keeps its diagnostic",
    budget.exactCount === 0 &&
      diag.some((m: string) => m.includes("budget range")),
    diag.join(" | ")
  );
}

console.log(`\n=== RESULT: ${passed}/${passed + failed} passed ===`);
process.exit(failed > 0 ? 1 : 0);