/* Build an Outfit — URL state parsing/serialization.

   The builder keeps its whole state in the URL (?gender, ?selected,
   ?accs, ?step...) so the flow survives refresh / back / share. Both
   the builder wizard and the Review page read the exact same shapes —
   one parser, one serializer, no drift between "what I picked" and
   "what you review".

   Pure module: no DB / network / I-O. */

export type BuildGender = "MEN" | "WOMEN" | "KIDS";

export type UrlBuildProduct = {
  id: string;
  name: string;
  price: string;
  currency: string | null;
  imageUrl: string | null;
  productUrl: string;
  brand: string | null;
  categorySlug: string;
  categoryName: string | null;
  gender: string | null;
  colors: string[];
  sizes: string[];
  fitScore?: number;
};

export type UrlPiece = {
  product: UrlBuildProduct;
  color: string | null;
};

export type UrlPiecesState = {
  /* one slot -> one piece (top/bottom/footwear/layer) */
  selected: Record<string, UrlPiece>;
  /* accessory is multi-slot: several pieces are allowed */
  accessories: UrlPiece[];
};

/* Gender param -> builder gender (only the three builder audiences). */
export const buildGenderFromParam = (g: string | null): BuildGender =>
  g === "WOMEN" || g === "KIDS" ? g : "MEN";

function toPiece(value: unknown): UrlPiece | null {
  const piece = (value ?? {}) as Partial<UrlPiece>;
  if (piece.product && typeof piece.product.id === "string") {
    return {
      product: piece.product as UrlBuildProduct,
      color: typeof piece.color === "string" ? piece.color : null,
    };
  }
  return null;
}

/* ?selected = {"top": {...}, "bottom": {...}, ...} */
export function parsePieces(raw: string | null): Record<string, UrlPiece> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null) return {};
    const out: Record<string, UrlPiece> = {};
    for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
      if (key === "accessory") continue;
      const piece = toPiece(value);
      if (piece) out[key] = piece;
    }
    return out;
  } catch {
    return {};
  }
}

/* ?accs = [{...}, {...}] */
export function parseAccessories(raw: string | null): UrlPiece[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map(toPiece)
      .filter((p): p is UrlPiece => p !== null);
  } catch {
    return [];
  }
}

/* Single JSON state reused by the review page URL as well. */
export function parseUrlState(gender: string | null, selected: string | null, accs: string | null): {
  gender: BuildGender;
  selected: Record<string, UrlPiece>;
  accessories: UrlPiece[];
} {
  return {
    gender: buildGenderFromParam(gender),
    selected: parsePieces(selected),
    accessories: parseAccessories(accs),
  };
}