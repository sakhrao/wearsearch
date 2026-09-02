/* Outfit builder — deterministic composition engine.
   Independent of the search engine. Driven by an injected catalog
   snapshot so it is unit-testable with no server/DB.

   Flow per anchor:
     anchor gate + profile + color
     -> slot templates (required vs optional)
     -> candidates per slot (gated by F1/F7/F8/gender/matrix)
     -> enumerate top-m combos for required slots
     -> rank by score (incl budgetFit), pick N diverse complete outfits
     -> attach optional slots greedily when they improve the score
     -> compute explanations
   No randomness; stable ties by product id. */

import {
  allowedCategoriesForAnchor,
  preferenceFor,
  slotOfCategory,
  slotTemplatesForCategory,
} from "./category-rules";
import {
  resolveCandidateColor,
  scoreCandidate,
} from "./compatibility";
import {
  candidatesForSlot,
  normalizeGender,
  type CandidateEntry,
} from "./candidate-generator";
import { explainOutfitLines, explainSlotItem } from "./explanations";
import {
  cosine,
  scoreOutfit,
  type OutfitScores,
} from "./scoring";
import { deriveStyleProfile } from "./style-profile";
import { normalizePriceToEur } from "@/lib/currency";
import type {
  GroundTruth,
  HarmonyLevel,
  Occasion,
  Outfit,
  OutfitProduct,
  PlacedItem,
  SlotName,
  StyleLabel,
  StyleProfile,
} from "./types";
import {
  colorHarmony,
} from "./color-harmony";
import { harmonyScore } from "./color-harmony";

/* Number of top candidates considered per required slot for the
   search space. Kept small for determinism + bounded compute. */
const TOP_M = 4;
const MAX_OUTFITS = 3;

export type BuilderOptions = {
  anchor: OutfitProduct;
  occasion?: Occasion | null;
  style?: StyleLabel | null;
  budget?: number | null;
  size?: string | null;
  products: OutfitProduct[];
  rate?: number | null;
  /* Additive: pre-placed products to lock into the look (used to
     reconstruct a saved/shared outfit). Remaining slots are filled
     around them. Empty by default -> identical to the size/frozen path. */
  lockProducts?: OutfitProduct[];
};

/* Normalize a product's stored price to EUR using the given rate. */
export function productPriceEur(
  p: OutfitProduct,
  rate: number | null
): number {
  return normalizePriceToEur(Number(p.price), p.currency, rate);
}

function anchorColorOf(anchor: OutfitProduct): { name: string; hex: string | null } | null {
  return resolveCandidateColor(anchor, null);
}

function anchorProfileOf(anchor: OutfitProduct): StyleProfile {
  return deriveStyleProfile(anchor);
}

function computeTotalEur(
  items: PlacedItem[],
  rate: number | null
): number {
  let total = 0;
  for (const it of items) {
    total += productPriceEur(it.product, rate);
  }
  return Math.round(total * 100) / 100;
}

type PartialOutfit = {
  items: PlacedItem[];
  profiles: StyleProfile[];
};

export function buildOutfits(options: BuilderOptions): Outfit[] {
  const {
    anchor,
    occasion = null,
    style = null,
    budget = null,
    size = null,
    products,
    rate = null,
    lockProducts = [],
  } = options;
  const truth: GroundTruth = {
    anchorId: anchor.id,
    occasion: occasion ?? null,
    style: style ?? null,
    budgetEur: budget ?? null,
  };

  const anchorSlug = anchor.category?.slug?.toLowerCase() ?? "";
  const anchorGender = normalizeGender(anchor.gender ?? null);
  const anchorColor = anchorColorOf(anchor);
  const anchorProfile = anchorProfileOf(anchor);

  const templates = slotTemplatesForCategory(anchorSlug);
  const requiredSlots = templates.filter((t) => t.required).map((t) => t.slot);
  const optionalSlots = templates.filter((t) => !t.required).map((t) => t.slot);

  const sizePref = size && size.trim() !== "" ? { value: size } : null;

  // Build candidate pools per required slot.
  const requiredPools: Map<SlotName, CandidateEntry[]> = new Map();
  for (const slot of requiredSlots) {
    const entries = candidatesForSlot({
      products,
      slot,
      anchorSlug,
      anchorGender,
      anchorProfile,
      anchorColor: anchorColor?.name ?? null,
      size: sizePref,
    });
    requiredPools.set(slot, entries.slice(0, TOP_M));
  }

  // The anchor is always the first item.
  const anchorItem: PlacedItem = {
    slot: slotOfCategory(anchorSlug),
    product: anchor,
    color: anchorColor,
  };

  // Optional pre-locked items (Share reconstruction): place each into
  // its natural slot and add its profile. They are excluded from the
  // pools' required/optional sets so the builder fills only the rest.
  const lockSlots = new Set<SlotName>();
  const lockedItems: PlacedItem[] = [];
  const lockedProfiles: StyleProfile[] = [];
  for (const lp of lockProducts) {
    if (lp.id === anchor.id) continue;
    const slug = lp.category?.slug?.toLowerCase() ?? "";
    const ls = slotOfCategory(slug);
    lockSlots.add(ls);
    lockedItems.push({
      slot: ls,
      product: lp,
      color: resolveCandidateColor(lp, anchorColor?.name ?? null),
    });
    lockedProfiles.push(deriveStyleProfile(lp));
  }

  // Base partial containing the anchor (+ any pre-locked items).
  const base: PartialOutfit = {
    items: [anchorItem, ...lockedItems],
    profiles: [anchorProfile, ...lockedProfiles],
  };

  // Required/optional slots to fill = templates minus locked slots.
  const fillRequired = requiredSlots.filter((s) => !lockSlots.has(s));
  const fillOptional = optionalSlots.filter((s) => !lockSlots.has(s));

  // Enumerate required-slot combos.
  const combos = enumerateCombos({
    requiredSlots: fillRequired,
    requiredPools,
    base,
    anchor,
    anchorSlug,
    anchorColor: anchorColor?.name ?? null,
    anchorProfile,
    rate,
    budget,
  });

  // Score each combo.
  const scored = combos.map((combo) => {
    const total = computeTotalEur(combo.items, rate);
    const scores = scoreOutfit({
      anchor,
      items: combo.items,
      profiles: combo.profiles,
      truth,
      totalPriceEur: total,
    });
    return { combo, total, scores };
  });

  // Stable sort: by score desc, then total asc, then first item id.
  scored.sort((a, b) => {
    if (b.scores.total !== a.scores.total) return b.scores.total - a.scores.total;
    if (a.total !== b.total) return a.total - b.total;
    return comboId(a.combo.items) < comboId(b.combo.items) ? -1 : 1;
  });

  // Budget is a HARD cap during fill: when a budget is set and at
  // least one scored combo fits within it, over-budget combos are
  // excluded from selection entirely (compatibility > budget applies
  // only when nothing fits). This is a hard filter on the sorted list,
  // not a second scoring weight.
  const withinBudget =
    budget == null || scored.some((c) => c.total <= budget);
  const eligible = withinBudget
    ? scored.filter((c) => budget == null || c.total <= budget)
    : scored;

  // Select N diverse outfits. Two looks count as the SAME when every
  // required slot carries the same (category, color) fingerprint —
  // i.e. a "different" product that is a same-category/same-color twin
  // does not count as real diversity. Each new look must therefore
  // differ from every already-chosen one in at least one required
  // slot's semantic fingerprint.
  const chosen: Array<{ combo: PartialOutfit; total: number; scores: OutfitScores }> = [];
  for (const c of eligible) {
    if (chosen.length >= MAX_OUTFITS) break;
    if (c.scores.total <= 0) break; // incoherent combo, stop
    const fps = lookFingerprints(c.combo.items, requiredSlots, anchor.id);
    const distinct = chosen.every((ec) =>
      differsFp(fps, lookFingerprints(ec.combo.items, requiredSlots, anchor.id))
    );
    if (distinct) {
      chosen.push(c);
    }
  }

  // Attach optional slots to each chosen outfit where they improve it.
  const outfits = chosen.map((c, idx) =>
    finalizeOutfit({
      ...c,
      idx,
      anchor,
      anchorSlug,
      anchorGender,
      anchorProfile,
      anchorColor: anchorColor?.name ?? null,
      optionalSlots: fillOptional,
      products,
      truth,
      rate,
      requiredSlots: fillRequired,
      size,
    })
  );

  return outfits;
}

function requiredIds(
  items: PlacedItem[],
  requiredSlots: SlotName[]
): string[] {
  return items
    .filter((it) => requiredSlots.includes(it.slot))
    .map((it) => it.product.id);
}

/* Semantic fingerprint of the required slots of a look. Two products
   that share a category and color are considered interchangeable for
   diversity purposes, so same-category/same-color twins do not count
   as a distinct look. Excludes the anchor product (it is constant). */
function lookFingerprints(
  items: PlacedItem[],
  requiredSlots: SlotName[],
  anchorId?: string
): string[] {
  const fps = items
    .filter(
      (it) =>
        requiredSlots.includes(it.slot) &&
        it.product.id !== anchorId
    )
    .map((it) => {
      const cat = it.product.category?.slug?.toLowerCase() ?? "";
      const color = it.color?.name?.toLowerCase() ?? "none";
      return `${it.slot}:${cat}:${color}`;
    })
    .sort();
  return fps;
}

function differsFp(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return !a.every((fp) => b.includes(fp));
}

function comboId(items: PlacedItem[]): string {
  return items.map((it) => it.product.id).join("|");
}

function enumerateCombos(args: {
  requiredSlots: SlotName[];
  requiredPools: Map<SlotName, CandidateEntry[]>;
  base: PartialOutfit;
  anchor: OutfitProduct;
  anchorSlug: string;
  anchorColor: string | null;
  anchorProfile: StyleProfile;
  rate: number | null;
  budget: number | null;
}): PartialOutfit[] {
  const { requiredSlots, requiredPools, base } = args;
  let partials: PartialOutfit[] = [base];

  const orderedSlots = requiredSlots; // fixed deterministic order

  for (const slot of orderedSlots) {
    const pool = requiredPools.get(slot) ?? [];
    const next: PartialOutfit[] = [];
    for (const p of partials) {
      if (pool.length === 0) {
        // No candidate for this required slot: leave it missing; the
        // final outfit will be complete:false.
        next.push(p);
        continue;
      }
      for (const cand of pool) {
        const item: PlacedItem = {
          slot,
          product: cand.product,
          color: cand.color,
        };
        next.push({
          items: [...p.items, item],
          profiles: [...p.profiles, cand.profile],
        });
      }
    }
    partials = next;
  }

  return partials;
}

function finalizeOutfit(args: {
  combo: PartialOutfit;
  total: number;
  scores: OutfitScores;
  idx: number;
  anchor: OutfitProduct;
  anchorSlug: string;
  anchorGender: "MEN" | "WOMEN" | "UNISEX" | "KIDS";
  anchorProfile: StyleProfile;
  anchorColor: string | null;
  optionalSlots: SlotName[];
  products: OutfitProduct[];
  truth: GroundTruth;
  rate: number | null;
  requiredSlots: SlotName[];
  size?: string | null;
}): Outfit {
  const {
    combo, total, scores, idx, anchor, anchorSlug, anchorGender,
    anchorProfile, anchorColor, optionalSlots, products, truth, rate, requiredSlots, size = null,
  } = args;

  let items = [...combo.items];
  let profiles = [...combo.profiles];
  let budgetOk = truth.budgetEur === null || total <= truth.budgetEur;

  // Greedily add optional slots only when they strictly improve the
  // fit (category+color+style) and don't push an unbounded cost over.
  const currentTotal = () => computeTotalEur(items, rate);
  const currentScore = () => {
    const t = currentTotal();
    const s = scoreOutfit({
      anchor,
      items,
      profiles,
      truth,
      totalPriceEur: t,
    });
    return { s, t };
  };

  for (const slot of optionalSlots) {
    const candidates = candidatesForSlot({
      products,
      slot,
      anchorSlug,
      anchorGender,
      anchorProfile,
      anchorColor,
      size: size && size.trim() !== "" ? { value: size } : null,
    });
    // find the best optional candidate that improves the outfit
    let bestAdd: { item: PlacedItem; profile: StyleProfile } | null = null;
    let bestGain = 0;
    for (const cand of candidates) {
      const trialItems = [...items, { slot, product: cand.product, color: cand.color }];
      const trialProfiles = [...profiles, cand.profile];
      const trialTotal = computeTotalEur(trialItems, rate);
      const trialScores = scoreOutfit({
        anchor,
        items: trialItems,
        profiles: trialProfiles,
        truth,
        totalPriceEur: trialTotal,
      });
      const gain = trialScores.total - currentScore().s.total;
      // Apply budget preference: if over budget, only add when it
      // clearly improves coherence (compatibility > budget).
      const withinBudget = truth.budgetEur === null || trialTotal <= truth.budgetEur;
      if (gain > 0.02 && (withinBudget || !budgetOk)) {
        if (gain > bestGain) {
          bestGain = gain;
          bestAdd = { item: { slot, product: cand.product, color: cand.color }, profile: cand.profile };
        }
      }
    }
    if (bestAdd) {
      items = [...items, bestAdd.item];
      profiles = [...profiles, bestAdd.profile];
      budgetOk = truth.budgetEur === null || computeTotalEur(items, rate) <= truth.budgetEur;
    }
  }

  const finalTotal = computeTotalEur(items, rate);
  const finalScores = scoreOutfit({
    anchor,
    items,
    profiles,
    truth,
    totalPriceEur: finalTotal,
  });

  // Determine completeness: every required slot must be filled.
  const filledRequired = new Set(
    items.filter((it) => requiredSlots.includes(it.slot)).map((it) => it.slot)
  );
  const missingSlots = requiredSlots.filter((s) => !filledRequired.has(s));
  const complete = missingSlots.length === 0;

  // Explanations.
  const explanations: Record<string, ExplanationLine[]> = {};
  for (const it of items) {
    const cand = it.product;
    const colorLevel = anchorColor
      ? colorHarmony(it.color?.name ?? null, anchorColor)
      : ("neutral" as HarmonyLevel);
    let styleScore = 0;
    let formalityScore = 0;
    // compute candidate's own style/formality vs anchor+placed mean
    const prof = cand.id === anchor.id ? anchorProfile : profileFor(cand, profiles);
    if (prof) {
      styleScore = cosineStyle(prof, profiles);
      formalityScore =
        1 - Math.min(1, Math.abs(prof.formality - meanFormality(profiles)));
    }
    const occText = truth.occasion ?? null;
    if (cand.id === anchor.id) {
      explanations[cand.id] = [
        {
          text: "Anchor product of this look",
          code: "anchor",
          value: 1,
        },
      ];
      continue;
    }
    explanations[cand.id] = explainSlotItem({
      slot: it.slot,
      product: cand,
      colorName: it.color?.name ?? null,
      colorLevel,
      anchorColorName: anchorColor,
      anchorName: anchor.name,
      styleScore,
      formalityScore,
      occasionText: occText,
      budgetOk,
    });
  }

  const outfitLines = explainOutfitLines(finalScores);

  return {
    id: `look-${idx + 1}`,
    complete,
    score: Math.round(finalScores.total * 1000) / 1000,
    totalPriceEur: finalTotal,
    items,
    missingSlots,
    explanations: {
      ...explanations,
      __outfit__: outfitLines,
    },
  };
}

type ExplanationLine = {
  text: string;
  code: string;
  value: number;
};

function profileFor(
  product: OutfitProduct,
  profiles: StyleProfile[]
): StyleProfile | null {
  // The builder matches by insertion order; we use the provided list.
  // For explanation, derive fresh.
  return deriveStyleProfile(product);
}

function meanFormality(profiles: StyleProfile[]): number {
  if (profiles.length === 0) return 0;
  let s = 0;
  for (const p of profiles) s += p.formality;
  return s / profiles.length;
}

function cosineStyle(
  prof: StyleProfile,
  profiles: StyleProfile[]
): number {
  const mean = meanVector(profiles);
  return cosine(prof.vector, mean);
}

function meanVector(profiles: StyleProfile[]): Record<string, number> {
  const keys = ["casual", "sporty", "streetwear", "smart-casual", "formal", "classic", "bohemian", "minimalist"] as const;
  const mean: Record<string, number> = {};
  for (const k of keys) mean[k] = 0;
  if (profiles.length === 0) return mean;
  for (const p of profiles) {
    for (const k of keys) mean[k] += p.vector[k] ?? 0;
  }
  for (const k of keys) mean[k] /= profiles.length;
  return mean;
}

export type ReplaceOptions = {
  anchor: OutfitProduct;
  slot: SlotName;
  currentItems: PlacedItem[];
  products: OutfitProduct[];
  occasion?: Occasion | null;
  style?: StyleLabel | null;
  budget?: number | null;
  size?: string | null;
  rate?: number | null;
  max?: number;
  /* Additive: product ids to exclude from the candidate pool (e.g.
     "Not my style", or removing a current item before re-adding). */
  excludeProductIds?: string[];
  /* When true, also exclude products whose style profile is very
     close to a rejected item (soft variety). */
  excludeSimilar?: boolean;
};

/* Replace a single slot: every other item in the current outfit is
   locked to its existing product; only `slot` is re-chosen. Returns
   up to `max` ranked, mutually-diverse replacement outfits. Does NOT
   rebuild the whole outfit. */

export function replaceSlot(options: ReplaceOptions): Outfit[] {
  const {
    anchor,
    slot,
    currentItems,
    products,
    occasion = null,
    style = null,
    budget = null,
    size = null,
    rate = null,
    max = 3,
    excludeProductIds = [],
    excludeSimilar = false,
  } = options;

  const truth: GroundTruth = {
    anchorId: anchor.id,
    occasion: occasion ?? null,
    style: style ?? null,
    budgetEur: budget ?? null,
  };

  const anchorSlug = anchor.category?.slug?.toLowerCase() ?? "";
  const anchorGender = normalizeGender(anchor.gender ?? null);
  const anchorColor = anchorColorOf(anchor);
  const anchorProfile = anchorProfileOf(anchor);

  // Lock every item except the anchor and the varied slot.
  const locked = currentItems.filter(
    (it) => it.product.id !== anchor.id && it.slot !== slot
  );

  // Build the base partial with anchor + locked items.
  const anchorItem: PlacedItem = {
    slot: slotOfCategory(anchorSlug),
    product: anchor,
    color: anchorColor,
  };
  const baseItems: PlacedItem[] = [anchorItem, ...locked];

  let candidates = candidatesForSlot({
    products,
    slot,
    anchorSlug,
    anchorGender,
    anchorProfile,
    anchorColor: anchorColor?.name ?? null,
    size: size && size.trim() !== "" ? { value: size } : null,
  });

  // Exclude explicitly rejected / to-remove products (Not my style) and
  // any current item already placed in another slot (defensive dup guard).
  const excluded = new Set(excludeProductIds);
  for (const it of locked) excluded.add(it.product.id);
  if (excluded.size > 0) {
    candidates = candidates.filter((c) => !excluded.has(c.product.id));
  }

  // Soft variety: skip products whose style profile is extremely close
  // to a rejected item (share nearly identical attribute vectors).
  if (excludeSimilar && excludeProductIds.length > 0) {
    const rejectedProfiles = products
      .filter((p) => excludeProductIds.includes(p.id))
      .map((p) => deriveStyleProfile(p));
    if (rejectedProfiles.length > 0) {
      candidates = candidates.filter((c) => {
        const profile = deriveStyleProfile(c.product);
        return !rejectedProfiles.some((r) => cosineStyle(profile, [r, r]) >= 0.99);
      });
    }
  }

  const scored: Array<{ items: PlacedItem[]; total: number; scores: OutfitScores }> = [];
  for (const cand of candidates) {
    const items: PlacedItem[] = [
      ...baseItems,
      { slot, product: cand.product, color: cand.color },
    ];
    const profiles = items.map((it) =>
      it.product.id === anchor.id
        ? anchorProfile
        : deriveStyleProfile(it.product)
    );
    const total = computeTotalEur(items, rate);
    const scores = scoreOutfit({
      anchor,
      items,
      profiles,
      truth,
      totalPriceEur: total,
    });
    scored.push({ items, total, scores });
  }

  scored.sort((a, b) => {
    if (b.scores.total !== a.scores.total) return b.scores.total - a.scores.total;
    if (a.total !== b.total) return a.total - b.total;
    const ida = a.items.map((i) => i.product.id).join("|");
    const idb = b.items.map((i) => i.product.id).join("|");
    return ida < idb ? -1 : 1;
  });

  // Budget hard cap during fill (mirrors buildOutfits): when a budget
  // is set and at least one replacement stays within it, exclude
  // over-budget replacements; compatibility > budget only when none fit.
  const withinBudget =
    budget == null || scored.some((c) => c.total <= budget);
  const eligible = withinBudget
    ? scored.filter((c) => budget == null || c.total <= budget)
    : scored;

  // Deterministic diversity: each variant differs from the others in
  // the varied slot's semantic fingerprint (category + color), so two
  // same-category/same-color replacement products do not both appear.
  const chosen: Array<{ items: PlacedItem[]; total: number; scores: OutfitScores }> = [];
  const seenFp = new Set<string>();
  for (const c of eligible) {
    if (chosen.length >= max) break;
    const vary = c.items.find((i) => i.slot === slot);
    const cat = vary?.product.category?.slug?.toLowerCase() ?? "";
    const color = vary?.color?.name?.toLowerCase() ?? "none";
    const fp = `${slot}:${cat}:${color}`;
    if (seenFp.has(fp)) continue;
    seenFp.add(fp);
    chosen.push(c);
  }

  return chosen.map((c, idx) =>
    finalizeFixed({
      items: c.items,
      scores: c.scores,
      idx,
      anchor,
      anchorSlug,
      anchorGender,
      anchorProfile,
      anchorColor: anchorColor?.name ?? null,
      products,
      truth,
      rate,
      slot,
    })
  );
}

/* finalize for replace: the varied slot is the only "required" slot
   being asserted; all locked items are already present. Completeness
   = the varied slot is filled (it always is, since we only return
   items that include it). */
function finalizeFixed(args: {
  items: PlacedItem[];
  scores: OutfitScores;
  idx: number;
  anchor: OutfitProduct;
  anchorSlug: string;
  anchorGender: "MEN" | "WOMEN" | "UNISEX" | "KIDS";
  anchorProfile: StyleProfile;
  anchorColor: string | null;
  products: OutfitProduct[];
  truth: GroundTruth;
  rate: number | null;
  slot: SlotName;
}): Outfit {
  const {
    items, scores, idx, anchor, anchorSlug, anchorGender, anchorProfile,
    anchorColor, products, truth, rate, slot,
  } = args;

  const finalTotal = computeTotalEur(items, rate);
  const finalScores = scoreOutfit({
    anchor,
    items,
    profiles: items.map((it) =>
      it.product.id === anchor.id ? anchorProfile : deriveStyleProfile(it.product)
    ),
    truth,
    totalPriceEur: finalTotal,
  });
  const budgetOk = truth.budgetEur === null || finalTotal <= truth.budgetEur;

  const explanations: Record<string, ExplanationLine[]> = {};
  for (const it of items) {
    if (it.product.id === anchor.id) {
      explanations[it.product.id] = [{ text: "Anchor product of this look", code: "anchor", value: 1 }];
      continue;
    }
    const colorLevel = anchorColor
      ? colorHarmony(it.color?.name ?? null, anchorColor)
      : ("neutral" as HarmonyLevel);
    const prof = deriveStyleProfile(it.product);
    const styleScore = cosineStyle(prof, [anchorProfile, ...items.map((x) => x.product.id === anchor.id ? anchorProfile : deriveStyleProfile(x.product))]);
    const formalityScore = 1 - Math.min(1, Math.abs(prof.formality - anchorProfile.formality));
    explanations[it.product.id] = explainSlotItem({
      slot: it.slot,
      product: it.product,
      colorName: it.color?.name ?? null,
      colorLevel,
      anchorColorName: anchorColor,
      anchorName: anchor.name,
      styleScore,
      formalityScore,
      occasionText: truth.occasion ?? null,
      budgetOk,
    });
  }

  return {
    id: `replace-${idx + 1}`,
    complete: true,
    score: Math.round(finalScores.total * 1000) / 1000,
    totalPriceEur: finalTotal,
    items,
    missingSlots: [],
    explanations: {
      ...explanations,
      __outfit__: explainOutfitLines(finalScores),
    },
  };
}
