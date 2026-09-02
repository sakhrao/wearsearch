/* Registry / mapping infrastructure (Phase 0).

   The canonical registries the source-agnostic architecture relies on:
     - Source registry        (upsert by name with priority/freshness)
     - BrandAlias             (raw token -> canonical Brand, human-curated)
     - CategoryMapping        (source token -> canonical Category, per source)
     - Identity index         (GtinRecord/MpnRecord -> Product)

   These are the ONLY writers for those tables, so the harness and the
   adapters share one deterministic resolution path. Canonical Brand and
   Category lookups are explicit (never similarity-guessed). */

import type { PrismaClient } from "../../generated/prisma/client";
import { SourceType, SourceStatus, type Prisma } from "../../generated/prisma/client";
import { slugToken, foldToken } from "./normalize";
import type { AdapterSourceType } from "./types";

export type Registry = {
  db: PrismaClient;
};

/* ---- Source registry ---- */

export type RegisterSourceInput = {
  name: string;
  type: AdapterSourceType;
  baseUrl?: string | null;
  priority: number;
  freshnessHours?: number | null;
  official?: boolean;
  authRef?: string | null;
};

export async function ensureSource(db: PrismaClient, input: RegisterSourceInput) {
  return db.source.upsert({
    where: { name: input.name },
    update: {
      type: input.type as SourceType,
      baseUrl: input.baseUrl ?? null,
      priority: input.priority,
      freshnessHours: input.freshnessHours ?? 24,
      official: input.official ?? false,
      authRef: input.authRef ?? null,
      status: SourceStatus.ACTIVE,
    },
    create: {
      name: input.name,
      type: input.type as SourceType,
      baseUrl: input.baseUrl ?? null,
      priority: input.priority,
      freshnessHours: input.freshnessHours ?? 24,
      official: input.official ?? false,
      status: SourceStatus.ACTIVE,
    },
  });
}

/* Resolve a source by name; null if not registered. */
export async function getSource(db: PrismaClient, name: string) {
  return db.source.findUnique({ where: { name } });
}

/* ---- BrandAlias resolution ---- */

/* Canonical brand for a raw source token under a source. Resolution
   order: per-source EXACT -> global EXACT -> CONTAINS match. Explicit
   keys only; a token with no alias yields null (quarantined upstream). */
export async function resolveBrand(
  db: PrismaClient,
  sourceId: string,
  rawToken: string
): Promise<string | null> {
  const token = foldToken(rawToken);
  if (!token) return null;

  const candidates = await db.brandAlias.findMany({
    where: {
      OR: [{ sourceId }, { sourceId: null }],
      kind: "EXACT",
    },
    include: { brand: true },
    orderBy: [{ sourceId: "desc" }, { token: "asc" }],
  });

  /* Per-source first: any token matching this source trumps globals. */
  const sourceHit = candidates.find(
    (alias) => alias.sourceId === sourceId && foldToken(alias.token) === token
  );
  const globalHit = candidates.find(
    (alias) => alias.sourceId === null && foldToken(alias.token) === token
  );
  const hit = sourceHit ?? globalHit;

  if (hit) return hit.brand.id;

  /* CONTAINS is a curated fallback; never applied to a bare "men"/"women". */
  const containsHit = await db.brandAlias.findFirst({
    where: { kind: "CONTAINS", sourceId },
    include: { brand: true },
  });
  if (containsHit && token.split(/\s+/).length > 1) {
    if (foldToken(containsHit.token) && token.includes(foldToken(containsHit.token))) {
      return containsHit.brand.id;
    }
  }

  return null;
}

/* Direct canonical-brand-by-name helper for tests and mapping seed. */
export async function canonicalBrandByName(
  db: PrismaClient,
  name: string
): Promise<string | null> {
  const brand = await db.brand.findUnique({ where: { name } });
  return brand ? brand.id : null;
}

/* Register a canonical brand (create if absent) - the ONLY brand-writer
   used by the harness; legacy provider sync keeps its own upsert path
   untouched. */
export async function ensureCanonicalBrand(db: PrismaClient, name: string) {
  return db.brand.upsert({
    where: { name },
    update: {},
    create: { name, slug: slugToken(name) },
  });
}

export type RegisterAliasInput = {
  brandName: string;
  token: string;
  sourceName?: string;
  kind?: "EXACT" | "CONTAINS";
};

export async function ensureBrandAlias(
  db: PrismaClient,
  input: RegisterAliasInput
): Promise<void> {
  const brand = await ensureCanonicalBrand(db, input.brandName);
  const source = input.sourceName ? await getSource(db, input.sourceName) : null;
  const token = foldToken(input.token);

  const existing = await db.brandAlias.findFirst({
    where: { token, sourceId: source?.id ?? null },
  });

  if (existing) {
    await db.brandAlias.update({
      where: { id: existing.id },
      data: { kind: input.kind ?? "EXACT" },
    });
  } else {
    await db.brandAlias.create({
      data: {
        brandId: brand.id,
        sourceId: source?.id ?? null,
        token,
        kind: input.kind ?? "EXACT",
      },
    });
  }
}

/* ---- CategoryMapping resolution ---- */

/* Canonical Category id for a raw source category token under a
   source, via the per-source mapping table. No fuzzy guessing. */
export async function resolveCategory(
  db: PrismaClient,
  sourceId: string,
  rawToken: string
): Promise<string | null> {
  const token = foldToken(rawToken);
  if (!token) return null;

  const mapping = await db.categoryMapping.findFirst({
    where: { sourceId, sourceToken: token },
    include: { category: true },
  });
  return mapping ? mapping.category.id : null;
}

export type RegisterCategoryMappingInput = {
  sourceName: string;
  sourceToken: string;
  canonicalSlug: string;
};

export async function ensureCategoryMapping(
  db: PrismaClient,
  input: RegisterCategoryMappingInput
): Promise<void> {
  const source = await getSource(db, input.sourceName);
  if (!source) throw new Error(`source '${input.sourceName}' not registered`);
  const category = await db.category.findUnique({ where: { slug: input.canonicalSlug } });
  if (!category) throw new Error(`category '${input.canonicalSlug}' not found`);
  await db.categoryMapping.upsert({
    where: {
      sourceId_sourceToken: {
        sourceId: source.id,
        sourceToken: foldToken(input.sourceToken),
      },
    },
    update: { categoryId: category.id },
    create: {
      sourceId: source.id,
      sourceToken: foldToken(input.sourceToken),
      categoryId: category.id,
    },
  });
}

/* ---- Identity index writers ---- */

export async function replaceGtinRecords(
  db: PrismaClient,
  productId: string,
  gtins: Array<{ gtin: string; gtinType: string }>
): Promise<void> {
  await db.gtinRecord.deleteMany({ where: { productId } });
  for (const gtin of gtins) {
    const existing = await db.gtinRecord.findFirst({
      where: { gtin: gtin.gtin, gtinType: gtin.gtinType, sourceId: null },
    });
    if (existing) {
      /* Another product already claims this GTIN. That is a dedup
         conflict the harness should have resolved: throw loudly
         instead of silently re-pointing the identity. */
      throw new Error(
        `gtin conflict: '${gtin.gtin}' already on product ${existing.productId}`
      );
    }
    await db.gtinRecord.create({
      data: { productId, gtin: gtin.gtin, gtinType: gtin.gtinType },
    });
  }
}

export async function replaceMpnRecords(
  db: PrismaClient,
  productId: string,
  brandId: string,
  mpn: string | null
): Promise<void> {
  await db.mpnRecord.deleteMany({ where: { productId } });
  if (!mpn || !brandId) return;
  const existing = await db.mpnRecord.findFirst({
    where: { brandId, mpn, sourceId: null },
  });
  if (existing) {
    throw new Error(
      `mpn conflict: '${mpn}' already on product ${existing.productId}`
    );
  }
  await db.mpnRecord.create({
    data: { productId, brandId, mpn },
  });
}

/* Lookup products by a strong identity. Returns product id or null.
   brandId is required for MPN/SKU layers. */
export async function findProductByGtin(
  db: PrismaClient,
  gtin: string
): Promise<string | null> {
  const record = await db.gtinRecord.findFirst({ where: { gtin } });
  return record ? record.productId : null;
}

export async function findProductByMpn(
  db: PrismaClient,
  brandId: string,
  mpn: string
): Promise<string | null> {
  const record = await db.mpnRecord.findFirst({ where: { brandId, mpn } });
  return record ? record.productId : null;
}