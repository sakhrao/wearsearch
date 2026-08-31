export type UnifiedAvailability = "AVAILABLE" | "OUT_OF_STOCK";

export type UnifiedGender = "MEN" | "WOMEN" | "UNISEX";

export interface UnifiedVariant {
  color: string | null;
  size: string | null;
  /* Per-variant explicit system for the size value, when the source
     states it (Livostyle explicit EU(US) strings). Bare numerics
     where the source carries no system are marked UNKNOWN (never
     inferred as US or EU). */
  sizeSystem?: "INTERNATIONAL" | "US" | "EU" | "UNKNOWN" | null;
  price: number;
  inStock: boolean;
}

export interface UnifiedProduct {
  externalId: string;
  name: string;
  brand: string;
  categorySlug: string;
  gender: UnifiedGender;
  colors: string[];
  sizes: string[];
  price: number;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  availability: UnifiedAvailability;
  variants?: UnifiedVariant[];
  sizeCategory?: "clothing" | "shoes";
  sizeSystem?: "INTERNATIONAL" | "US" | "EU";
  attributes?: Array<{ name: string; value: string }>;
}

export interface DroppedItem {
  id: string;
  title: string;
  reason: string;
}

export interface ProviderFetchResult {
  providerId: string;
  fetched: number;
  products: UnifiedProduct[];
  dropped: DroppedItem[];
}

export interface ProductProvider {
  id: string;
  sourceName: string;
  fetchUnified(): Promise<ProviderFetchResult>;
}
