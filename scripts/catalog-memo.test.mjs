/* RC-2 + O2: deterministic unit tests for the catalog memo.

   Run with: npx tsx scripts/catalog-memo.test.mjs

   Uses a stub Prisma client only - no server, no database, fully
   deterministic. Covers the two things that make the cache safe:

   1. Fingerprint recomputed on every access; an entry is served
      ONLY while its stored fingerprint equals the current one.
   2. Any catalog/dictionary change flips the fingerprint, so a
      subsequent access recomputes instead of serving stale data.

   The module's own DATA_MEMO / fingerprint live on this process's
   globalThis, fully isolated from the running dev server. */

import assert from "node:assert/strict";

import {
  computeCatalogFingerprint,
  createCatalogStore,
  getCatalogMemo,
} from "../src/lib/catalog-memo";

const makeNow = (iso) => new Date(iso);

const makeStubClient = (overrides = {}) => {
  const base = {
    product: () => ({
      aggregate: async () => ({
        _max: { updatedAt: makeNow("2026-01-01T00:00:00Z") },
        _count: 12,
      }),
    }),
    productVariant: () => ({
      aggregate: async () => ({
        _max: { updatedAt: makeNow("2026-01-01T00:00:00Z") },
      }),
    }),
    brand: () => ({ count: async () => 3 }),
    category: () => ({ count: async () => 5 }),
    color: () => ({ count: async () => 4 }),
    size: () => ({ count: async () => 9 }),
    attribute: () => ({ count: async () => 2 }),
    productAttribute: () => ({ count: async () => 20 }),
  };

  const apply = (value) =>
    typeof value === "function" ? value() : value;

  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === "product") {
          return apply(overrides.product ?? base.product());
        }
        if (prop === "productVariant") {
          return apply(
            overrides.productVariant ?? base.productVariant()
          );
        }
        for (const name of [
          "brand",
          "category",
          "color",
          "size",
          "attribute",
          "productAttribute",
        ]) {
          if (prop === name) {
            return apply(overrides[name] ?? base[name]());
          }
        }
        return undefined;
      },
    }
  );
};

let total = 0;
let passed = 0;

const check = async (name, fn) => {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`ok ${total} - ${name}`);
  } catch (error) {
    console.error(`FAIL ${total} - ${name}`);
    throw error;
  }
};

const main = async () => {
  const fingerprintStable = await computeCatalogFingerprint(
    makeStubClient()
  );

  /* --- fingerprint: stable for identical catalog ----------- */
  await check(
    "fingerprint is identical for identical catalogs",
    async () => {
      const a = await computeCatalogFingerprint(makeStubClient());
      const b = await computeCatalogFingerprint(makeStubClient());
      assert.equal(a, fingerprintStable);
      assert.equal(b, fingerprintStable);
      assert.ok(typeof a === "string" && a.length > 0);
    }
  );

  /* --- fingerprint: flips on any mutation ------------------- */
  await check(
    "fingerprint flips when a product updateAt advances",
    async () => {
      const after = await computeCatalogFingerprint(
        makeStubClient({
          product: {
            aggregate: async () => ({
              _max: { updatedAt: makeNow("2026-01-02T00:00:00Z") },
              _count: 12,
            }),
          },
        })
      );
      assert.notEqual(after, fingerprintStable);
    }
  );

  await check(
    "fingerprint flips when a productVariant updateAt advances",
    async () => {
      const after = await computeCatalogFingerprint(
        makeStubClient({
          productVariant: {
            aggregate: async () => ({
              _max: { updatedAt: makeNow("2026-01-02T00:00:00Z") },
            }),
          },
        })
      );
      assert.notEqual(after, fingerprintStable);
    }
  );

  await check(
    "fingerprint flips when the product count changes",
    async () => {
      const after = await computeCatalogFingerprint(
        makeStubClient({
          product: {
            aggregate: async () => ({
              _max: { updatedAt: makeNow("2026-01-01T00:00:00Z") },
              _count: 13,
            }),
          },
        })
      );
      assert.notEqual(after, fingerprintStable);
    }
  );

  await check(
    "fingerprint flips when a brand is added/removed",
    async () => {
      const after = await computeCatalogFingerprint(
        makeStubClient({ brand: { count: async () => 4 } })
      );
      assert.notEqual(after, fingerprintStable);
    }
  );

  /* --- getCatalogMemo: hit serves one load per fingerprint -- */
  await check(
    "getCatalogMemo loads once per stable fingerprint, returns same data",
    async () => {
      let loads = 0;
      const load = async () => {
        loads += 1;
        return { rows: [1, 2, 3] };
      };
      const fingerprint = await computeCatalogFingerprint(makeStubClient());

      const first = await getCatalogMemo(
        makeStubClient(),
        fingerprint,
        "unit-dicts",
        load
      );
      const second = await getCatalogMemo(
        makeStubClient(),
        fingerprint,
        "unit-dicts",
        load
      );

      assert.equal(loads, 1);
      assert.deepEqual(first, { rows: [1, 2, 3] });
      assert.equal(second, first);
    }
  );

  /* --- getCatalogMemo: fingerprint change forces reload ------ */
  await check(
    "getCatalogMemo never serves stale data after a fingerprint change",
    async () => {
      let loads = 0;
      let value = "v1";
      const load = async () => {
        loads += 1;
        return { value };
      };
      const fp1 = await computeCatalogFingerprint(makeStubClient());
      const a = await getCatalogMemo(
        makeStubClient(),
        fp1,
        "unit-stale",
        load
      );

      value = "v2";
      const fp2 = await computeCatalogFingerprint(
        makeStubClient({
          productVariant: {
            aggregate: async () => ({
              _max: { updatedAt: makeNow("2026-01-02T00:00:00Z") },
            }),
          },
        })
      );

      const b = await getCatalogMemo(
        makeStubClient(),
        fp2,
        "unit-stale",
        load
      );

      assert.equal(a.value, "v1");
      assert.equal(b.value, "v2");
      assert.equal(loads, 2);
    }
  );

  /* --- getCatalogMemo: keys are isolated ---------------------- */
  await check(
    "getCatalogMemo keys are isolated from each other",
    async () => {
      const fp1 = await computeCatalogFingerprint(makeStubClient());
      let count = 0;
      const load = async () => ({ count: (count += 1) });

      await getCatalogMemo(makeStubClient(), fp1, "unit-iso-a", load);
      await getCatalogMemo(makeStubClient(), fp1, "unit-iso-b", load);
      await getCatalogMemo(makeStubClient(), fp1, "unit-iso-a", load);
      await getCatalogMemo(makeStubClient(), fp1, "unit-iso-b", load);

      assert.equal(count, 2);
    }
  );

  /* --- createCatalogStore: local store semantics ------------- */
  await check(
    "local store: hit on same key+fingerprint, miss on change, keys isolated",
    () => {
      const store = createCatalogStore();
      const data = { ids: [1, 2] };

      assert.equal(store.get("k", "fp1"), null);
      store.set("k", "fp1", data);
      assert.equal(store.get("k", "fp1"), data);
      assert.equal(store.get("k", "fp2"), null);
      assert.equal(store.get("other", "fp1"), null);
    }
  );

  /* --- createCatalogStore: cap resets safely ------------------ */
  await check(
    "local store: exceeding the cap clears entries but never serves stale",
    () => {
      const store = createCatalogStore({ cap: 2 });
      store.set("a", "fp", { n: 1 });
      store.set("b", "fp", { n: 2 });
      // third set overflows -> map cleared
      store.set("c", "fp", { n: 3 });
      assert.equal(store.get("a", "fp"), null);
      assert.equal(store.get("b", "fp"), null);
      // the new entry itself is valid
      assert.deepEqual(store.get("c", "fp"), { n: 3 });
    }
  );

  /* --- createCatalogStore: global slot shares one map --------- */
  await check(
    "slotted stores share a map; distinct slots stay isolated",
    () => {
      const slotName =
        "unitSlot-" + Math.random().toString(36).slice(2);
      const s1 = createCatalogStore({ slot: slotName });
      const s2 = createCatalogStore({ slot: slotName });
      const s3 = createCatalogStore({
        slot: slotName + "-other",
      });

      s1.set("k", "fp", { v: 42 });
      assert.deepEqual(s2.get("k", "fp"), { v: 42 });
      assert.equal(s3.get("k", "fp"), null);
    }
  );

  console.log(`\ncatalog-memo: ${passed}/${total} checks passed`);
  if (passed !== total) process.exitCode = 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});