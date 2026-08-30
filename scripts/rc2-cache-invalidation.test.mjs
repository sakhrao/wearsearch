/* RC-2: end-to-end stale-data proof for the pipeline cache.

   Run with the dev server up:  npx tsx scripts/rc2-cache-invalidation.test.mjs

   Proves the cache can never serve stale data against a changed
   catalog: a real (hasRealProductPage-passing) product taken from
   a live search payload is temporarily suffixed with a unique probe
   token, /api/search must start returning it, and the original name
   is restored in a finally block (the fingerprint then flips back,
   so no cached envelope survives either way). */

import assert from "node:assert/strict";

import { prisma } from "../src/lib/prisma";

const search = async (q) => {
  const res = await fetch(`http://localhost:3000/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
};

const token = `zzrc2probe${Date.now().toString(36)}${Math.random()
  .toString(36)
  .slice(2, 8)}`;

/* Pick a product that actually surfaces in a real search payload,
   so it is guaranteed to pass the F1 real-page serialization gate. */
const seed = await search("clothing");
assert.ok(seed.exactProducts.length > 0, "no seed products");
const target = seed.exactProducts[0];
assert.ok(target.id, "seed product has no id");

const originalName = target.name;
const renamed = `${token} ${originalName}`;

const assertRestored = async (label) => {
  const row = await prisma.product.findUnique({
    where: { id: target.id },
    select: { name: true },
  });
  assert.equal(row.name, originalName, `${label}: name not restored`);
};

let checks = 0;
const ok = (label, condition) => {
  checks += 1;
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }
  console.log(`ok ${checks} - ${label}`);
};

try {
  const before = await search(token);
  ok(
    `probe query '${token}' returns 0 exact before mutation`,
    before.exactCount === 0
  );

  await prisma.product.update({
    where: { id: target.id },
    data: { name: renamed },
  });

  const after = await search(token);
  ok(
    "cache recomputes after a catalog mutation and finds the renamed product",
    after.exactCount >= 1 &&
      after.exactProducts.some((p) => p.id === target.id)
  );
} finally {
  await prisma.product.update({
    where: { id: target.id },
    data: { name: originalName },
  });
  await assertRestored("finally");
}

const afterRestore = await search(token);
ok(
  "cache recomputes again after restore (no stale entry survives)",
  afterRestore.exactCount === 0
);

console.log(`\nrc2-cache-invalidation: ${checks}/${checks} checks passed`);