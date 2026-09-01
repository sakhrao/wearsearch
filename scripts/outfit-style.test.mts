import { deriveStyleProfile, STYLE_LABELS } from "../src/lib/outfit/style-profile";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}${extra ? " :: " + extra : ""}`);
  }
}

function makeProduct(over: Record<string, unknown>) {
  const base = {
    id: "p1",
    name: "Some top",
    price: "10",
    currency: "EUR",
    productUrl: "https://shop.example/p/1",
    imageUrl: null,
    availability: "AVAILABLE",
    gender: "WOMEN",
    brand: { id: "b", name: "B" },
    category: { id: "c", slug: "t-shirts", name: "T-Shirts" },
    variants: [],
    attributes: [],
  };
  return { ...base, ...over } as any;
}

/* --- source: attribute is authoritative --- */
const attrCasual = deriveStyleProfile(
  makeProduct({ attributes: [{ attribute: { name: "Style" }, value: "Casual" }] })
);
check("Style=Casual -> casual is dominant",
  attrCasual.vector.casual >= 0.9);
check("Style=Casual source = attribute",
  attrCasual.source === "attribute");

/* --- source: bohemian value is normalized --- */
const boho = deriveStyleProfile(
  makeProduct({ attributes: [{ attribute: { name: "Style" }, value: "Bohemian" }] })
);
check("Style=Bohemian -> bohemian dominant",
  boho.vector.bohemian >= 0.9);
check("Bohemian source = attribute", boho.source === "attribute");

/* --- priority: attribute beats category ---
   A t-shirt with Style=Formal should be formal-ish, not casual,
   because the Style attribute overrides the category default. */
const attrFormal = deriveStyleProfile(
  makeProduct({ attributes: [{ attribute: { name: "Style" }, value: "Formal" }] })
);
check("Style=Formal on a t-shirt -> formal dominant over casual",
  attrFormal.vector.formal > attrFormal.vector.casual);
check("Formal source = attribute", attrFormal.source === "attribute");

/* --- category default when no Style attr --- */
const catOnly = deriveStyleProfile(makeProduct({}));
check("t-shirt (no attr) source = category",
  catOnly.source === "category");
check("t-shirt (no attr) casual dominant",
  catOnly.vector.casual >= 0.7);

/* --- hint (attribute-hint) beats plain category, loses to style attr --- */
const hint = deriveStyleProfile(
  makeProduct({ attributes: [{ attribute: { name: "Fit" }, value: "Slim" }] })
);
check("Fit=Slim -> source attribute-hint", hint.source === "attribute-hint");

/* --- title is the weakest source, only when nothing stronger --- */
const titleOnly = deriveStyleProfile(
  makeProduct({ name: "Oversized streetwear hoodie" })
);
check("title keyword triggers source=title OR category, not attribute",
  titleOnly.source !== "attribute");

/* --- formality scalar is deterministic and reflects the vector --- */
check("formal vector has high formality",
  attrFormal.formality > 0.6);
check("casual vector has lower formality",
  attrCasual.formality < 0.5);

/* --- no AI: profile is pure rules, no field for AI --- */
check("all style labels exist", STYLE_LABELS.length === 8);

console.log(`\noutfit-style: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
