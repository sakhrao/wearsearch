import type { PrismaClient } from "../../generated/prisma/client";

export const ATTRIBUTE_NAMES = [
  "Sleeve",
  "Collar",
  "Fit",
  "Style",
  "Pattern",
  "Material",
] as const;

export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

export const LIVOSTYLE_TAG_MAP: Record<
  string,
  { attribute: AttributeName; value: string }
> = {
  "long sleeve": { attribute: "Sleeve", value: "Long Sleeve" },
  "short sleeve": { attribute: "Sleeve", value: "Short Sleeve" },
  sleeveless: { attribute: "Sleeve", value: "Sleeveless" },
  "3/4 sleeve": { attribute: "Sleeve", value: "3/4 Sleeve" },
  "three-quarter sleeve": { attribute: "Sleeve", value: "3/4 Sleeve" },
  "cap sleeve": { attribute: "Sleeve", value: "Cap Sleeve" },
  "puff sleeve": { attribute: "Sleeve", value: "Puff Sleeve" },
  "puff sleeves": { attribute: "Sleeve", value: "Puff Sleeve" },
  "balloon sleeve": { attribute: "Sleeve", value: "Balloon Sleeve" },
  "v-neck": { attribute: "Collar", value: "V-Neck" },
  "round neck": { attribute: "Collar", value: "Round Neck" },
  "crew neck": { attribute: "Collar", value: "Crew Neck" },
  collared: { attribute: "Collar", value: "Collared" },
  "collared neckline": { attribute: "Collar", value: "Collared" },
  "square neckline": { attribute: "Collar", value: "Square Neck" },
  "square neck": { attribute: "Collar", value: "Square Neck" },
  "scoop neck": { attribute: "Collar", value: "Scoop Neck" },
  "halter neck": { attribute: "Collar", value: "Halter Neck" },
  "high neck": { attribute: "Collar", value: "High Neck" },
  "mock neck": { attribute: "Collar", value: "Mock Neck" },
  "boat neck": { attribute: "Collar", value: "Boat Neck" },
  "polo neck": { attribute: "Collar", value: "Polo" },
  "split neckline": { attribute: "Collar", value: "Split Neck" },
  "split neck": { attribute: "Collar", value: "Split Neck" },
  "relaxed fit": { attribute: "Fit", value: "Relaxed" },
  fitted: { attribute: "Fit", value: "Fitted" },
  oversized: { attribute: "Fit", value: "Oversized" },
  "straight leg": { attribute: "Fit", value: "Straight Leg" },
  "wide leg": { attribute: "Fit", value: "Wide Leg" },
  "wide leg pants": { attribute: "Fit", value: "Wide Leg" },
  casual: { attribute: "Style", value: "Casual" },
  "casual style": { attribute: "Style", value: "Casual" },
  "business casual": { attribute: "Style", value: "Casual" },
  athleisure: { attribute: "Style", value: "Sport" },
  activewear: { attribute: "Style", value: "Sport" },
  athletic: { attribute: "Style", value: "Sport" },
  sportswear: { attribute: "Style", value: "Sport" },
  bohemian: { attribute: "Style", value: "Boho" },
  boho: { attribute: "Style", value: "Boho" },
  "boho vibes": { attribute: "Style", value: "Boho" },
  formal: { attribute: "Style", value: "Formal" },
  classic: { attribute: "Style", value: "Classic" },
  retro: { attribute: "Style", value: "Retro" },
  minimalist: { attribute: "Style", value: "Minimalist" },
  contemporary: { attribute: "Style", value: "Contemporary" },
  utility: { attribute: "Style", value: "Utility" },
  "utility style": { attribute: "Style", value: "Utility" },
  solid: { attribute: "Pattern", value: "Solid" },
  "solid color": { attribute: "Pattern", value: "Solid" },
  "solid pattern": { attribute: "Pattern", value: "Solid" },
  "solid print": { attribute: "Pattern", value: "Solid" },
  plain: { attribute: "Pattern", value: "Solid" },
  "no pattern": { attribute: "Pattern", value: "Solid" },
  striped: { attribute: "Pattern", value: "Striped" },
  checkered: { attribute: "Pattern", value: "Checked" },
  checkerboard: { attribute: "Pattern", value: "Checked" },
  "checkerboard pattern": { attribute: "Pattern", value: "Checked" },
  gingham: { attribute: "Pattern", value: "Checked" },
  "floral print": { attribute: "Pattern", value: "Floral" },
  floral: { attribute: "Pattern", value: "Floral" },
  "tie-dye": { attribute: "Pattern", value: "Tie-Dye" },
  "tie dye": { attribute: "Pattern", value: "Tie-Dye" },
  "polka dot": { attribute: "Pattern", value: "Polka Dot" },
  "leopard print": { attribute: "Pattern", value: "Leopard" },
  "animal print": { attribute: "Pattern", value: "Animal" },
  "zebra print": { attribute: "Pattern", value: "Zebra" },
  "geometric print": { attribute: "Pattern", value: "Geometric" },
  "geometric pattern": { attribute: "Pattern", value: "Geometric" },
  geometric: { attribute: "Pattern", value: "Geometric" },
  "abstract print": { attribute: "Pattern", value: "Abstract" },
  "graphic print": { attribute: "Pattern", value: "Graphic" },
  camouflage: { attribute: "Pattern", value: "Camouflage" },
  "camouflage print": { attribute: "Pattern", value: "Camouflage" },
  cotton: { attribute: "Material", value: "Cotton" },
  leather: { attribute: "Material", value: "Leather" },
  "faux leather": { attribute: "Material", value: "Leather" },
  "patent leather": { attribute: "Material", value: "Leather" },
  suede: { attribute: "Material", value: "Suede" },
  denim: { attribute: "Material", value: "Denim" },
  "denim tops": { attribute: "Material", value: "Denim" },
  "linen blend": { attribute: "Material", value: "Linen" },
  satin: { attribute: "Material", value: "Satin" },
};

export const SLEEVE_LENGTH_VALUES = new Set([
  "Long Sleeve",
  "Short Sleeve",
  "Sleeveless",
  "3/4 Sleeve",
]);

export const NECKLINE_VALUES = new Set([
  "V-Neck",
  "Round Neck",
  "Crew Neck",
  "High Neck",
  "Mock Neck",
  "Scoop Neck",
  "Square Neck",
  "Halter Neck",
  "Boat Neck",
  "Split Neck",
  "Polo",
]);

export const SPECIFIC_PATTERN_VALUES = new Set(
  Object.values(LIVOSTYLE_TAG_MAP)
    .filter((m) => m.attribute === "Pattern" && m.value !== "Solid")
    .map((m) => m.value)
);

function applyPolicy(attribute: AttributeName, values: string[]): string[] {
  if (values.length === 0) return [];
  const uniq = [...new Set(values)];
  if (attribute === "Sleeve") {
    const lengths = uniq.filter((v) => SLEEVE_LENGTH_VALUES.has(v));
    const styles = uniq.filter((v) => !SLEEVE_LENGTH_VALUES.has(v));
    if (lengths.length > 1) return styles.length ? styles : [];
    return [...lengths, ...styles];
  }
  if (attribute === "Collar") {
    const specific = uniq.filter((v) => NECKLINE_VALUES.has(v));
    if (specific.length > 1) return [];
    return uniq;
  }
  if (attribute === "Pattern") {
    const specific = uniq.filter((v) => SPECIFIC_PATTERN_VALUES.has(v));
    if (specific.length > 1) return [];
    if (specific.length === 1 && uniq.includes("Solid")) return specific;
    return uniq;
  }
  return uniq;
}

export function attributesFromTags(
  tags: readonly string[] | undefined
): { name: AttributeName; value: string }[] {
  if (!tags || tags.length === 0) return [];
  const found: Record<AttributeName, string[]> = {
    Sleeve: [],
    Collar: [],
    Fit: [],
    Style: [],
    Pattern: [],
    Material: [],
  };
  for (const raw of tags) {
    const mapping = LIVOSTYLE_TAG_MAP[String(raw).trim().toLowerCase()];
    if (!mapping) continue;
    found[mapping.attribute].push(mapping.value);
  }
  const out: { name: AttributeName; value: string }[] = [];
  for (const name of ATTRIBUTE_NAMES) {
    for (const value of applyPolicy(name, found[name])) {
      out.push({ name, value });
    }
  }
  return out;
}

type AttributeWriteDb = Pick<
  PrismaClient,
  "attribute" | "productAttribute"
>;

export async function writeProductAttributes(
  db: AttributeWriteDb,
  productId: string,
  attributes: readonly { name: string; value: string }[]
): Promise<{ written: number }> {
  await db.productAttribute.deleteMany({ where: { productId } });
  if (attributes.length === 0) return { written: 0 };
  const rows = await Promise.all(
    attributes.map(async ({ name, value }) => {
      if (!(ATTRIBUTE_NAMES as readonly string[]).includes(name)) {
        throw new Error(
          `attribute '${name}' is not in the allowed F6 attribute set`
        );
      }
      const attributeId = await db.attribute.upsert({
        where: { name },
        update: {},
        create: { name, type: "SELECT" },
      });
      return { productId, attributeId: attributeId.id, value };
    })
  );
  await db.productAttribute.createMany({ data: rows });
  return { written: rows.length };
}