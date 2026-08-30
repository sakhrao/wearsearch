/* O3 regression guard.
   Static, deterministic, no DB / no server:
   the search catalog `select` (src/app/api/search/route.ts) must not
   pull columns the pipeline, projection and client never read. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const routePath = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
  "src/app/api/search/route.ts"
);
const source = readFileSync(routePath, "utf8");

const REQUIRED_SCALARS = [
  "description",
  "price",
  "currency",
  "productUrl",
  "imageUrl",
  "gender",
  "availability",
];

const REQUIRED_OBJECTS = ["variants", "attributes"];

const REQUIRED_NESTS = [
  ["brand", ["id", "name"]],
  ["category", ["id", "name"]],
  ["color", ["id", "name", "hex"]],
  ["size", ["value"]],
];

let passed = 0;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
};

const start = source.indexOf("prisma.product.findMany");
const end = source.indexOf("const attributeValues");
if (start < 0 || end < 0 || end <= start) {
  fail("could not locate the catalog select block in route.ts");
} else {
  const block = source.slice(start, end);
  const poss = (anchor) => {
    const at = block.indexOf(anchor);
    if (at < 0) throw new Error(`anchor '${anchor}' not found`);
    return at;
  };
  const seg = (a, b) => block.slice(a, b);

  const keyRe = /^\s*([A-Za-z][A-Za-z0-9_]*):\s*(true,?|\{)/gm;

  check("select block is present and closed", () => {
    if (block.length < 100) throw new Error("unexpectedly small select block");
    if (end <= start) throw new Error("block end precedes start");
  });

  check("required scalar columns remain selected", () => {
    const keys = [...block.matchAll(keyRe)].map((m) => m[1]);
    for (const field of REQUIRED_SCALARS) {
      if (!keys.includes(field)) throw new Error(`'${field}' missing`);
    }
  });

  check("required relation objects remain selected", () => {
    const keys = [...block.matchAll(keyRe)].map((m) => m[1]);
    for (const field of REQUIRED_OBJECTS) {
      if (!keys.includes(field)) throw new Error(`'${field}' missing`);
    }
  });

  check("nested relations keep their required fields", () => {
    for (const [owner, wanted] of REQUIRED_NESTS) {
      let close = block.indexOf("\n              },", poss(`${owner}: {`));
      if (close < 0) {
        close = block.indexOf("\n            },", poss(`${owner}: {`));
      }
      if (close < 0) throw new Error(`'${owner}' block not closed`);
      const ownerBlock = seg(poss(`${owner}: {`), close);
      const keys = [...ownerBlock.matchAll(keyRe)].map((m) => m[1]);
      for (const field of wanted) {
        if (!keys.includes(field)) throw new Error(`'${owner}.${field}' missing`);
      }
    }
  });

  check("brand/category select no longer pull slug", () => {
    const brand = seg(poss("brand: {"), block.indexOf("\n          },", poss("brand: {")));
    const category = seg(poss("category: {"), block.indexOf("\n          },", poss("category: {")));
    for (const [name, sub] of [["brand.slug", brand], ["category.slug", category]]) {
      if (/^\s*slug: true,$/m.test(sub)) throw new Error(`'${name}' still selected`);
    }
  });

  check("variants no longer pull id/sku and their children stay minimal", () => {
    const variants = seg(
      poss("variants: {"),
      block.indexOf("\n          },", poss("variants: {"))
    );
    if (/^\s*id: true,$/m.test(variants)) throw new Error("'variants.id' still selected");
    if (/^\s*sku: true,$/m.test(variants)) throw new Error("'variants.sku' still selected");
    const colorOpen = poss("color: {");
    if (colorOpen > 0 && colorOpen < poss("variants: {")) {
      const color = seg(colorOpen, block.indexOf("\n                  },", colorOpen));
      if (/^\s*slug: true,$/m.test(color)) throw new Error("'color.slug' still selected");
    }
    const sizeOpen = block.indexOf("size: {", poss("variants: {"));
    const size = seg(sizeOpen, block.indexOf("\n                  },", sizeOpen));
    if (/^\s*id: true,$/m.test(size)) throw new Error("'size.id' still selected");
    if (/^\s*normalizedValue: true,$/m.test(size)) {
      throw new Error("'size.normalizedValue' still selected");
    }
    if (/^\s*system: true,$/m.test(size)) throw new Error("'size.system' still selected");
    if (!/^\s*value: true,$/m.test(size)) throw new Error("'size.value' must remain");
  });

  check("no forbidden token leaks anywhere in the select block", () => {
    for (const token of ["sku: true", "system: true", "normalizedValue: true"]) {
      if (block.includes(token)) throw new Error(`'${token}' present in select`);
    }
    const slugCount = (block.match(/^\s*slug: true,$/gm) ?? []).length;
    if (slugCount !== 0) throw new Error(`${slugCount} slug column(s) still selected`);
  });
}

if (process.exitCode) {
  console.error("O3 select guard FAILED. See messages above.");
  process.exit(1);
}

console.log("\nO3 select guard: all checks green.");