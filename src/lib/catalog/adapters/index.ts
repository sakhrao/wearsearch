/* Registered source adapters.

   Phase 0 deliberately ships ZERO commercial adapters: eBay ingestion
   is deferred until the schema + pure engines + harness are tested.
   A brand/source is added later by registering its adapter here:

       export const adapters: CommerceSourceAdapter[] = [
         ebayAdapter,          // -> src/lib/catalog/adapters/ebay.ts (Phase 1)
       ];

   Until then the import CLI reports "no adapters registered" and the
   harness is exercised through its own test fixtures. */

import type { CommerceSourceAdapter } from "../types";
import { createEbayAdapter } from "./ebay";

/* Registered source adapters.

   Phase 0 shipped zero commercial adapters; the import CLI reported
   "no adapters registered" and the harness was exercised purely through
   test fixtures. eBay (Phase 1) is the first real source. It reads its
   credentials from the environment (see .env.example) and only becomes
   usable for import once configured. State is created eagerly so the
   CLI can report a clean "not configured" message instead of
   crashing. */

const ebayAdapter = createEbayAdapter();

export const registeredAdapters: CommerceSourceAdapter[] = [ebayAdapter];

export function findAdapter(id: string): CommerceSourceAdapter | undefined {
  return registeredAdapters.find((adapter) => adapter.id === id);
}