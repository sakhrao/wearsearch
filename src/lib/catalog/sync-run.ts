/* Sync-run + quarantine tracking (Phase 0).

   Every controlled source sync records a SourceSyncRun - the
   freshness/degradation audit trail. Search never reads these tables;
   they drive ops decisions only.

   ProductQuarantine parks low-quality / unmapped raw listings (payload
   + reason) so nothing here ever surfaces in Search, but a human or
   re-run can repair the mapping and resync. */

import type { PrismaClient } from "../../generated/prisma/client";
import { SyncRunStatus } from "../../generated/prisma/client";
import type { ValidationVerdict } from "./types";

export type SyncRunHandle = {
  runId: string;
  sourceId: string;
};

export async function startSyncRun(
  db: PrismaClient,
  sourceId: string
): Promise<SyncRunHandle> {
  const run = await db.sourceSyncRun.create({
    data: { sourceId, status: SyncRunStatus.RUNNING },
  });
  return { runId: run.id, sourceId };
}

export type SyncRunOutcome = {
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  droppedCount: number;
  quarantinedCount: number;
};

export async function finishSyncRun(
  db: PrismaClient,
  handle: SyncRunHandle,
  outcome: SyncRunOutcome,
  error?: string
): Promise<void> {
  await db.sourceSyncRun.update({
    where: { id: handle.runId },
    data: {
      finishedAt: new Date(),
      status: error ? SyncRunStatus.FAILED : SyncRunStatus.SUCCESS,
      ...outcome,
      error: error ?? null,
    },
  });
  await db.source.update({
    where: { id: handle.sourceId },
    data: {
      lastSyncedAt: new Date(),
      status: error ? "ERROR" : "ACTIVE",
    },
  });
}

export type QuarantineInput = {
  sourceId: string;
  externalListingId: string;
  reason: string;
  categoryToken?: string | null;
  brandToken?: string | null;
  rawData?: unknown;
};

/* Upsert semantics: a re-run overwrites the quarantine row for the same
   listing (keeps one row per (source, listing) rather than growing
   unboundedly). */
export async function quarantineListing(
  db: PrismaClient,
  input: QuarantineInput
): Promise<void> {
  await db.productQuarantine.upsert({
    where: {
      sourceId_externalListingId: {
        sourceId: input.sourceId,
        externalListingId: input.externalListingId,
      },
    },
    update: {
      reason: input.reason,
      categoryToken: input.categoryToken ?? null,
      brandToken: input.brandToken ?? null,
      rawData: (input.rawData as object | null) ?? undefined,
    },
    create: {
      sourceId: input.sourceId,
      externalListingId: input.externalListingId,
      reason: input.reason,
      categoryToken: input.categoryToken ?? null,
      brandToken: input.brandToken ?? null,
      rawData: (input.rawData as object | null) ?? undefined,
    },
  });
}

/* Collapse a ValidationVerdict (ACCEPT/QUARANTINE/REJECT) into the
   quarantine-facing reason string the harness feeds to quarantineListing
   when a listing does not ACCEPT. */
export function verdictReason(verdict: ValidationVerdict): string {
  if (verdict.status === "ACCEPT") return "";
  return verdict.reasons.join("; ");
}