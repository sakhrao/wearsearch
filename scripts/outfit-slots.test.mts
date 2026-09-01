import { slotTemplatesForCategory } from "../src/lib/outfit/category-rules";

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

function requiredOf(slug: string): string[] {
  return slotTemplatesForCategory(slug)
    .filter((t) => t.required)
    .map((t) => t.slot)
    .sort();
}
function optionalOf(slug: string): string[] {
  return slotTemplatesForCategory(slug)
    .filter((t) => !t.required)
    .map((t) => t.slot)
    .sort();
}

/* footwear anchors: requires bottom+top; layer/accessory optional */
for (const slug of ["sneakers", "loafers", "heels", "sandals", "boots"]) {
  check(`${slug}: required bottom+top`,
    JSON.stringify(requiredOf(slug)) === JSON.stringify(["bottom", "top"]));
  check(`${slug}: no required accessory`,
    !requiredOf(slug).includes("accessory"));
}

/* tops anchors: requires bottom; layer/footwear/accessory optional */
for (const slug of ["t-shirts", "tank-tops", "blouses", "button-ups", "polos"]) {
  check(`${slug}: required bottom`, JSON.stringify(requiredOf(slug)) === JSON.stringify(["bottom"]));
}

/* bottoms anchors: requires top */
for (const slug of ["trousers", "jeans", "joggers", "leggings", "chinos"]) {
  check(`${slug}: required top`, JSON.stringify(requiredOf(slug)) === JSON.stringify(["top"]));
}

/* layering anchors: requires bottom+top (an outerwear anchor still
   needs a base top + bottom) */
for (const slug of ["hoodies", "sweatshirts", "cardigans"]) {
  check(`${slug}: required bottom+top`,
    JSON.stringify(requiredOf(slug)) === JSON.stringify(["bottom", "top"]));
}

/* The key required-vs-optional contract: an optional slot failing
   must never affect completeness. This is enforced by the builder
   (complete = every REQUIRED slot filled). Here we assert the
   template marks accessory/layer as optional for footwear. */
check("sneakers optional includes layer+accessory",
  JSON.stringify(optionalOf("sneakers")) === JSON.stringify(["accessory", "layer"]) || "layer" === optionalOf("sneakers")[1]);

console.log(`\noutfit-slots: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
