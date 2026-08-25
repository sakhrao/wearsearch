export type UnifiedAvailability = "AVAILABLE" | "OUT_OF_STOCK";

export type UnifiedGender = "MEN" | "WOMEN" | "UNISEX";

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
