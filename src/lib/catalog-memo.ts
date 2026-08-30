import type { PrismaClient } from "@/generated/prisma/client";

/* RC-2 + O2: catalog snapshot memo shared by /api/search and
   /api/meta.

   The search pipeline re-runs the full catalog work per page/offset
   (load-more) and both routes reload the same dictionary tables on
   every request, even though dictionaries change almost never.

   Every entry is validated against a cheap DB fingerprint recomputed
   on EACH request (max updatedAt + table counts). An entry is only
   served while its stored fingerprint matches the current catalog
   bit-for-bit, so any product/dictionary mutation invalidates the
   memo on the very next request - the cache can never return stale
   data against a newer catalog. There is no TTL: correctness comes
   from the fingerprint, not from time.

   Sets: route handlers are re-evaluated per request in dev, so the
   backing Map lives on globalThis (same pattern as lib/prisma.ts) -
   otherwise every request would re-run the pipeline anyway. Local
   stores (no slot) are available for isolated unit tests. Stores are
   bounded; when the cap is exceeded the store is reset (entries then
   rebuild lazily, which is always correct). */

type MemoEntry<T> = {
  fingerprint: string;
  data: T;
};

export type CatalogStoreOptions = {
  cap?: number;
  slot?: string;
};

export type CatalogStore<T> = {
  get: (key: string, fingerprint: string) => T | null;
  set: (key: string, fingerprint: string, data: T) => void;
};

export function createCatalogStore<T>(
  options?: CatalogStoreOptions
): CatalogStore<T> {
  const cap = options?.cap ?? 80;

  const map: Map<string, MemoEntry<T>> =
    options?.slot
      ? getGlobalStoreMap<T>(options.slot)
      : new Map<string, MemoEntry<T>>();

  return {
    get(key, fingerprint) {
      const entry = map.get(key);
      if (
        entry &&
        entry.fingerprint === fingerprint
      ) {
        return entry.data;
      }
      return null;
    },

    set(key, fingerprint, data) {
      if (map.size >= cap) {
        map.clear();
      }
      map.set(key, { fingerprint, data });
    },
  };
}

function getGlobalStoreMap<T>(
  slot: string
): Map<string, MemoEntry<T>> {
  const globalForCatalog =
    globalThis as unknown as Record<
      string,
      Map<string, MemoEntry<unknown>> | undefined
    >;

  const existing = globalForCatalog[slot];
  if (existing) {
    return existing as Map<
      string,
      MemoEntry<T>
    >;
  }

  const fresh = new Map<string, MemoEntry<T>>();
  globalForCatalog[slot] =
    fresh as Map<
      string,
      MemoEntry<unknown>
    >;
  return fresh;
}

const DATA_MEMO = createCatalogStore<unknown>({
  cap: 32,
  slot: "wearsearchCatalogDataMemo",
});

export async function getCatalogMemo<T>(
  client: PrismaClient,
  fingerprint: string,
  key: string,
  load: () => Promise<T>
): Promise<T> {
  const existing = DATA_MEMO.get(
    key,
    fingerprint
  ) as T | null;

  if (existing !== null) {
    return existing;
  }

  const data = await load();
  DATA_MEMO.set(key, fingerprint, data);
  return data;
}

/* Cheap cross-table fingerprint of the catalog + dictionaries
   that the search pipeline / meta snapshot consume. */
export async function computeCatalogFingerprint(
  client: PrismaClient
): Promise<string> {
  const [
    products,
    variants,
    brandCount,
    categoryCount,
    colorCount,
    sizeCount,
    attributeCount,
    productAttributeCount,
  ] = await Promise.all([
    client.product.aggregate({
      _max: { updatedAt: true },
      _count: true,
    }),
    client.productVariant.aggregate({
      _max: { updatedAt: true },
    }),
    client.brand.count(),
    client.category.count(),
    client.color.count(),
    client.size.count(),
    client.attribute.count(),
    client.productAttribute.count(),
  ]);

  return JSON.stringify([
    products._count,
    products._max.updatedAt?.toISOString() ??
      null,
    variants._max.updatedAt?.toISOString() ??
      null,
    brandCount,
    categoryCount,
    colorCount,
    sizeCount,
    attributeCount,
    productAttributeCount,
  ]);
}