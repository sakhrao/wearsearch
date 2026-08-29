const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

/* =====================================================================
   PR2-F1 (demo/placeholder exclusion) re-baseline — 2026-08-28.

   The 79 demo/placeholder products (StyleHub Affiliate Feed 67 +
   WearSearch Demo Store 12; empty productUrl, placehold.co images,
   fictional brands) are now excluded from production-facing results
   by the F1 filter in src/app/api/search/route.ts (hasRealPage),
   LATER than every ranking decision. The catalog and ranking rules
   are untouched; only the serialized result set shrank.

   Consequent count changes are therefore INTENDED here, not bugs:
     - attribute-only queries (organs Material/Fit/Style/Collar) drop to
       0: the 504 real products carry no attributes (479/504 ... only the
       79 demo items had them) -> honest empty, matching search
       diagnostics (F6 data gap, tracked separately under PR2).
     - fictional-brand queries lose their fake hits: nike 10->1 (only
       real Nike = DummyJSON "Nike Air Jordan 1 Red And Black"),
       zara 25->0, adidas 8->0, new balance sneaker 2->0.
     - real catalog genders: MEN 11 / WOMEN 493 / UNISEX 0. All 21
       UNISEX products were demo, so gender queries now surface only
       their own gender (spec §2 UNISEX-admission holds vacuously).
     - jeans 6->1 (one real WOMEN jean remains), t-shirts 19->12,
       tank tops 58->51, shoes 71->49, clothing subtree 455.
   ===================================================================== */

const CASES = [
  {
    q: "black tank top",
    exact: 21,
    similar: 0,
    struct: { category: "Tank Tops", color: "Black" },
    note: "core exact flow; F7-S2 re-based: the OOS Racerback Active Tank (Turquoise) carries a Black variant so S2 exclusions moved black tanks 22->21",
  },
  {
    q: "nike black tank top",
    exact: 0,
    similar: 0,
    struct: { brand: "Nike", category: "Tank Tops", color: "Black" },
    note: "brand+color+category combined",
  },
  {
    q: "white sneaker 41",
    exact: 2,
    similar: 0,
    struct: { category: "Sneakers", color: "White", size: "41" },
    note: "EU shoe size; re-based P1/P5: livostyle shoe sizes restored from 'NN(USx)' source strings",
  },
  {
    q: "women jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "gender isolation; UNISEX admitted to Exact per spec §2; PR2-F1 re-based: real catalog has exactly 1 WOMEN jean (no UNISEX jeans)",
  },
  {
    q: "leather shoes",
    exact: 5,
    similar: 0,
    struct: { category: "Shoes", attributes: ["Material:Leather"] },
    note: "F6 close: leather shoes now carry Material:Leather (9 in catalog, 5 are Shoes)",
  },
  {
    q: "slim fit black",
    exact: 0,
    similar: 0,
    struct: { color: "Black", attributes: ["Fit:Slim"] },
    note: "changed intentionally in 6.3: attribute match remains eligible as Similar despite color mismatch (no color penalty stack kills attr-only candidates)",
  },
  {
    q: "men jeans",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "men isolation; PR2-F1 re-based: no real MEN jeans in catalog -> honest empty",
  },
  {
    q: "ladies jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'ladies' -> WOMEN hard filter (no men's leak in Exact or Similar)",
  },
  {
    q: "womens jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'womens' -> WOMEN hard filter",
  },
  {
    q: "women's jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: possessive form documents existing apostrophe tokenization path",
  },
  {
    q: "female jeans",
    exact: 1,
    similar: 0,
    struct: { gender: "WOMEN", category: "Jeans" },
    note: "new in 6.5.2: mirror case for existing 'female' word",
  },
  {
    q: "mens jeans",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'mens' -> MEN hard filter (no women's leak in Exact or Similar)",
  },
  {
    q: "men's jeans",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: possessive form documents existing apostrophe tokenization path",
  },
  {
    q: "male jeans",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: mirror case for existing 'male' word",
  },
  {
    q: "gentlemen jeans",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN", category: "Jeans" },
    note: "new in 6.5.2: gender synonym 'gentlemen' -> MEN hard filter",
  },
  {
    q: "women t-shirt",
    exact: 9,
    similar: 0,
    struct: { gender: "WOMEN", category: "T-Shirts" },
    note: "unisex included in women scope; re-based P1/P4: Square Neck Crisscross Active T-Shirt moved from Sneakers to T-Shirts",
  },
  {
    q: "men tank top",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN", category: "Tank Tops" },
    note: "unisex included in men scope",
  },
  {
    q: "women tank top",
    exact: 50,
    similar: 0,
    struct: { gender: "WOMEN", category: "Tank Tops" },
    note: "unisex included in women scope; F7-S2 re-based: 1 OOS WOMEN tank excluded -> 51->50",
  },
  {
    q: "BLACK TANK TOP",
    exact: 21,
    similar: 0,
    note: "case-insensitive normalization; F7-S2 re-based: black tanks 22->21 (OOS Black-variant Active Tank excluded)",
  },
  {
    q: "black   tank   top",
    exact: 21,
    similar: 0,
    note: "multi-space normalization; F7-S2 re-based: black tanks 22->21 (OOS Black-variant Active Tank excluded)",
  },
  {
    q: "black tank-top",
    exact: 21,
    similar: 0,
    note: "changed intentionally in 6.2: hyphen-split tokenization treats it like 'black tank top'; F7-S2 re-based: black tanks 22->21 (OOS Black-variant Active Tank excluded)",
  },
  {
    q: "blue tank tops",
        exact: 15,
        similar: 0,
        struct: { category: "Tank Tops", color: "Blue" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — blue Jeans no longer enter via color alone",
  },
  {
    q: "h&m jeans",
        exact: 0,
        similar: 0,
        struct: { brand: "H&M", category: "Jeans" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — non-Jeans H&M items no longer enter via brand alone",
  },
  {
    q: "tops",
    exact: 411,
    similar: 0,
    struct: { category: "Tops" },
    note: "parent category hierarchy; re-based P1/P4: mislabeled T-Shirt (was Sneakers) is now a Top; PR2-F2 re-based: 37 real Hoodies + 34 real Sweatshirts imported -> Tops subtree 346->417; F7-S2 re-based: 6 OOS Tops excluded (blouses 5 + tank 1) -> 417->411",
  },
  {
    q: "clothing",
    exact: 517,
    similar: 0,
    struct: { category: "Clothing" },
    note: "root category hierarchy; re-based P1/P4 (list shifted from Sneakers to T-Shirts; net +1 in Clothing); PR2-F2 re-based: 71 real Hoodies/Sweatshirts joined the Clothing tree -> Clothing 455->526; F7-S2 re-based: all 9 OOS products sit in the Clothing subtree -> 526->517",
  },
  {
    q: "bottoms",
    exact: 106,
    similar: 0,
    struct: { category: "Bottoms" },
    note: "mid-level hierarchy; F7-S2 re-based: 3 OOS Bottoms excluded (trousers 2 + joggers 1) -> 109->106",
  },
  {
    q: "shoes",
    exact: 49,
    similar: 0,
    struct: { category: "Shoes" },
    note: "separate root branch; re-based P1/P4: mislabeled T-Shirt removed from the Shoes tree",
  },
  {
    q: "sneaker 42",
    exact: 7,
    similar: 0,
    note: "similar item at score 0 boundary (score>=0 inclusion); re-based P1/P5: the four Trendsi sneakers now carry real size 42 variants",
  },
  {
    q: "size medium black tank top",
    exact: 18,
    similar: 0,
    struct: { color: "Black", size: "M" },
    note: "new in 6.5.2: 'medium' -> M intent; 3 black tanks stock M, Women Black Basic Tank is S-only so it lands in Similar",
  },
  {
    q: "extra small tank top",
    exact: 2,
    similar: 0,
    struct: { category: "Tank Tops", size: "XS" },
    note: "new in 6.5.2: 'extra small' -> XS; no tank stocks XS so honest Similar-only (mirrors XXL behavior)",
  },
  {
    q: "double extra large tank top",
    exact: 6,
    similar: 0,
    struct: { category: "Tank Tops", size: "XXL" },
    note: "new in 6.5.2: longest-phrase 'double extra large' -> XXL; no tank stocks it so honest Similar-only",
  },
  {
    q: "eu 41 sneakers",
    exact: 7,
    similar: 0,
    struct: { category: "Sneakers", size: "41" },
    note: "new in 6.5.2: numeric system prefix 'eu' stays inert, numeric size untouched by letter aliases; re-based P1/P5: real EU 41 sizes restored on Trendsi sneakers",
  },
  {
    q: "tee",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.3: category synonym 'tee' -> T-Shirts structured intent; re-based P1/P4 (+Square Neck Crisscross Active T-Shirt)",
  },
  {
    q: "tees",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.3: plural synonym 'tees' -> T-Shirts; re-based P1/P4 (+Square Neck Crisscross Active T-Shirt)",
  },
  {
    q: "black tee",
        exact: 3,
        similar: 0,
        struct: { category: "T-Shirts", color: "Black" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal; re-based P1/P4 (Square Neck Crisscross Active T-Shirt is now correctly a black tee)",
  },
  {
    q: "white tee",
        exact: 0,
        similar: 0,
        struct: { category: "T-Shirts", color: "White" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — only in-subtree white tees remain in Similar",
  },
  {
    q: "trainer",
    exact: 14,
    similar: 0,
    struct: { category: "Sneakers" },
    note: "new in 6.5.3: 'trainer' -> Sneakers structured intent; re-based P1/P4 (mislabeled T-Shirt left the Sneakers branch)",
  },
  {
    q: "trainers",
    exact: 14,
    similar: 0,
    struct: { category: "Sneakers" },
    note: "new in 6.5.3: British synonym 'trainers' -> Sneakers; re-based P1/P4 (mislabeled T-Shirt left the Sneakers branch)",
  },
  {
    q: "white trainers",
        exact: 5,
        similar: 0,
        struct: { category: "Sneakers", color: "White" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal — white tees no longer enter Sneakers queries via color alone",
  },
  {
    q: "tshirt",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.5: compact spelling 'tshirt' -> T-Shirts (G8); re-based P1/P4 (+Square Neck Crisscross Active T-Shirt)",
  },
  {
    q: "tshirts",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    note: "new in 6.5.5: compact plural spelling -> T-Shirts; re-based P1/P4 (+Square Neck Crisscross Active T-Shirt)",
  },
  {
    q: "black tshirt",
        exact: 3,
        similar: 0,
        struct: { category: "T-Shirts", color: "Black" },
        note: "updated intentionally in 6.8: cross-branch Similar leakage removal; re-based P1/P4 (Square Neck Crisscross Active T-Shirt is now correctly a black tee)",
  },
  {
    q: "tanktop",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.5: compact spelling 'tanktop' -> Tank Tops; F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "tanktops",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.5: compact plural spelling -> Tank Tops; F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "black tanktop",
    exact: 21,
    similar: 0,
    struct: { category: "Tank Tops", color: "Black" },
    note: "new in 6.5.5: compact spelling + color must equal native 'black tank top' result set; F7-S2 re-based: black tanks 22->21",
  },
  {
    q: "women tshirts",
    exact: 9,
    similar: 0,
    struct: { category: "T-Shirts", gender: "WOMEN" },
    note: "new in 6.5.5: gender + compact spelling compose like native 'women t-shirt'; re-based P1/P4",
  },
  {
    q: "tank",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: bare 'tank' promoted from lucky free-text hit to structured category intent; F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "tanks",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: 'tanks' -> Tank Tops structured intent; F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "black tank",
    exact: 21,
    similar: 0,
    struct: { category: "Tank Tops", color: "Black" },
    note: "new in 6.5.3: must equal 'black tank top' result set exactly; F7-S2 re-based: black tanks 22->21",
  },
  {
    q: "tank top",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: native phrase regression guard while short alias exists; F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "tank tops",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    note: "new in 6.5.3: plural native phrase guard; F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "pants",
    exact: 0,
    similar: 0,
    note: "new in 6.5.3: unsupported category intent (no Bottoms-class stock beyond Jeans); honest empty, never Jeans Exact",
  },
  {
    q: "black pants",
    exact: 0,
    similar: 168,
    struct: { color: "Black" },
    note: "new in 6.5.3: unsupported intent gates Exact off (kills pre-spec misleading Exact x4); Similar keeps color-relevant candidates; counts match simulation proxy; PR2-F2 re-based: +17 Black Hoodies/Sweatshirts entered the real catalog -> similar 153->170; F7-S2 re-based: 2 OOS black faux-leather trousers excluded -> similar 170->168",
  },
  {
    q: "cargo pants",
    exact: 0,
    similar: 0,
    note: "changed intentionally in 6.9: Cargo is now a real (empty) category; category scope + 80% gate -> honest empty instead of inert-word similarity",
  },
  {
    q: "jeans m",
    exact: 1,
    similar: 0,
    struct: { category: "Jeans", size: "M" },
    note: "clothing letter size",
  },
  {
    q: "tank top xl",
    exact: 36,
    similar: 0,
    struct: { category: "Tank Tops", size: "XL" },
    note: "size with no variants",
  },
  {
    q: "cotton tank top",
    exact: 0,
    similar: 0,
    struct: { category: "Tank Tops", attributes: ["Material:Cotton"] },
    note: "material attribute; PR2-F1 re-based: no real product carries attributes (F6 data gap) -> honest empty",
  },
  {
    q: "denim jeans",
    exact: 0,
    similar: 0,
    struct: { category: "Jeans", attributes: ["Material:Denim"] },
    note: "material attribute; PR2-F1 re-based: no real attribute data (F6 data gap) -> honest empty",
  },
  {
    q: "classic shoes",
    exact: 1,
    similar: 0,
    struct: { category: "Shoes", attributes: ["Style:Classic"] },
    note: "F6 close: Style:Classic on real catalog (2 total, 1 is Shoes)",
  },
  {
    q: "",
    exact: 0,
    similar: 0,
    note: "empty query",
  },
  {
    q: "   ",
    exact: 0,
    similar: 0,
    note: "whitespace-only query",
  },
  {
    q: "x",
    exact: 0,
    similar: 0,
    note: "single char below min word length",
  },
  {
    q: "n/a",
    exact: 0,
    similar: 0,
    note: "n/a must produce no signal",
  },
  {
    q: "!!! ???",
    exact: 0,
    similar: 0,
    note: "punctuation-only evaporates",
  },
  {
    q: "xyzqqq",
    exact: 0,
    similar: 0,
    note: "gibberish",
  },
  {
    q: "123456",
    exact: 0,
    similar: 0,
    note: "numeric noise",
  },
  {
    q: "zz ".repeat(50),
    exact: 0,
    similar: 0,
    note: "long repeated noise",
  },
  {
    q: "zara",
    exact: 0,
    similar: 0,
    struct: { brand: "Zara" },
    note: "brand-only; PR2-F1 re-based: every Zara item was a demo/placeholder product (empty productUrl) -> zara 25->0 honest empty",
  },
  {
    q: "red tank top",
    exact: 1,
    similar: 0,
    struct: { category: "Tank Tops", color: "Red" },
    note: "unavailable color",
  },
  {
    q: "green shoes",
    exact: 1,
    similar: 0,
    struct: { category: "Shoes", color: "Green" },
    note: "unavailable color; re-based P1/P4: the Matcha-green T-Shirt (a non-shoe) no longer leaks into green-shoes"
  },
  {
    q: "unisex t-shirt",
    exact: 0,
    similar: 0,
    struct: { gender: "UNISEX", category: "T-Shirts" },
    note: "strict unisex excludes MEN/WOMEN; PR2-F1 re-based: real catalog has no UNISEX products (all 21 were demo) -> honest empty",
  },
  {
    q: "sleeveless top",
    exact: 104,
    similar: 0,
    struct: { category: "Tops", attributes: ["Sleeve:Sleeveless"] },
    note: "F6 close: Sleeve:Sleeveless on real catalog (112 total, 106 in Tops); F7-S2 re-based: 2 OOS Sleeveless in Tops excluded -> 106->104",
  },
  {
    q: "round neck",
    exact: 45,
    similar: 0,
    struct: { attributes: ["Collar:Round Neck"] },
    note: "F6 close: Collar:Round Neck on real catalog (46 = target); F7-S2 re-based: 1 OOS Round Neck included that target -> 46->45",
  },
  {
    q: "skinny jeans",
    exact: 0,
    similar: 0,
    struct: { category: "Jeans", attributes: ["Fit:Skinny"] },
    note: "fit attribute with one mismatch allowed",
  },
  {
    q: "straight jeans",
    exact: 0,
    similar: 0,
    struct: { category: "Jeans", attributes: ["Fit:Straight"] },
    note: "fit attribute with one mismatch allowed",
  },
  {
    q: "sport top",
    exact: 41,
    similar: 0,
    struct: { category: "Tops", attributes: ["Style:Sport"] },
    note: "F6 close: Style:Sport on real catalog (88 total, 42 in Tops); F7-S2 re-based: 1 OOS Sport-in-Tops excluded -> 42->41",
  },
  {
    q: "new balance sneaker",
    exact: 0,
    similar: 0,
    struct: { brand: "New Balance", category: "Sneakers" },
    note: "PR2-F1 re-based: the only New Balance items were demo/placeholder (empty productUrl) -> honest empty (previously covered the score-0 similar boundary with demo data)",
  },
  {
    q: "adidas",
    exact: 0,
    similar: 0,
    struct: { brand: "Adidas" },
    note: "brand across categories; PR2-F1 re-based: every Adidas item was demo/placeholder (empty productUrl) -> adidas 8->0 honest empty",
  },
  {
    q: "brown shoe",
    exact: 4,
    similar: 0,
    struct: { category: "Shoes", color: "Brown" },
    note: "singular form matches plural dictionary entry",
  },
  {
    q: "women sneakers",
    exact: 10,
    similar: 0,
    struct: { gender: "WOMEN", category: "Sneakers" },
    note: "plural category + gender scope; re-based P1/P4 (mislabeled T-Shirt left the Sneakers branch)",
  },
  {
    q: "women's black cotton tank top size S",
    exact: 0,
    similar: 18,
    struct: {
      gender: "WOMEN",
      category: "Tank Tops",
      color: "Black",
      size: "S",
      attributes: ["Material:Cotton"],
    },
    note: "new in 6.2: possessive + 'size' keyword + full structured parse",
  },
  {
    q: "WOMEN'S  Black COTTON Tank-Top  SIZE s",
    exact: 0,
    similar: 18,
    struct: {
      gender: "WOMEN",
      category: "Tank Tops",
      color: "Black",
      size: "S",
      attributes: ["Material:Cotton"],
    },
    note: "new in 6.2: chaotic casing/spacing/hyphen normalizes to same result",
  },
  {
    q: "black nike hoodie for men",
    exact: 0,
    similar: 0,
    struct: { brand: "Nike", color: "Black", category: "Hoodies", gender: "MEN" },
    note: "changed intentionally in 6.9: Hoodies became a real (empty) category; sibling candidates fail the 80% gate (3/4) -> honest empty, diagnostic explains the blocked category",
  },
  {
    q: "men hoodie",
    exact: 0,
    similar: 0,
    struct: { gender: "MEN" },
    note: "changed intentionally in 6.2: unknown word with gender-only structure falls back to similar, never blanket-exact; changed intentionally in 6.3: structural-intent admission prevents gender-only similarity (no hoodie in catalog, so honest empty result)",
  },
  {
    q: "hooded",
    exact: 0,
    similar: 0,
    struct: { category: null, gender: null },
    note: "new in PR2 F2-A: 'hooded' registered as unsupported garment-class intent; was free-text match-all (504), now honest empty + diagnostic",
  },
  {
    q: "hoodie",
    exact: 37,
    similar: 0,
    struct: { category: "Hoodies" },
    note: "new in PR2 F2-B: Hoodies is now a stocked category (37 real Trendsi hoodies imported from `Clothing Tops > Hoodies`); was the empty stub that made 'hoodie' an honest-empty in F2-A",
  },
  {
    q: "hoodies",
    exact: 37,
    similar: 0,
    struct: { category: "Hoodies" },
    note: "new in PR2 F2-B: plural form maps to the same stocked category",
  },
  {
    q: "sweatshirt",
    exact: 34,
    similar: 0,
    struct: { category: "Sweatshirts" },
    note: "PR2 F2-B re-based: Sweatshirts became a stocked category (34 real products from `Clothing Tops > Sweatshirts`); in F2-A this word was unsupported intent (honest empty) to stop the match-all flood",
  },
  {
    q: "sweatshirts",
    exact: 34,
    similar: 0,
    struct: { category: "Sweatshirts" },
    note: "PR2 F2-B re-based: plural form resolves to the same stocked category",
  },
  {
    q: "sweatpants",
    exact: 18,
    similar: 0,
    struct: { category: "Joggers" },
    note: "new in PR2 F2-A: 'sweatpants' aliased to the Joggers category (11 of the 19 real Joggers products carry 'Sweatpants' in the name); was free-text match-all (504); F7-S2 re-based: 1 OOS jogger excluded -> 19->18",
  },
  {
    q: "zara black tank-top",
    exact: 0,
    similar: 0,
    struct: { brand: "Zara", category: "Tank Tops", color: "Black" },
    note: "new in 6.2: hyphenated input with brand masking",
  },
  {
    q: "classic leather shoes",
    exact: 0,
    similar: 0,
    struct: {
      category: "Shoes",
      attributes: ["Style:Classic", "Material:Leather"],
    },
    note: "new in 6.2: two simultaneous attribute detections with masking",
  },
  {
    q: "size",
    exact: 0,
    similar: 0,
    note: "new in 6.2: structural stopword alone produces no signal",
  },
  {
    q: "for",
    exact: 0,
    similar: 0,
    note: "new in 6.2: structural stopword alone produces no signal",
  },
  {
    q: "shirt",
    exact: 0,
    similar: 0,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Sweatshirts", "T-Shirts", "Tank Tops"],
    },
    note: "updated in 6.7.2 INTENTIONALLY: empty-category sibling substitution fills the dead end with constraint-clean siblings (no color/gender/attr intent here -> all 7)",
  },
  {
    q: "shirts",
    exact: 0,
    similar: 0,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Sweatshirts", "T-Shirts", "Tank Tops"],
    },
    note: "updated in 6.7.2 INTENTIONALLY: same detection as 'shirt', sibling substitution applies identically",
  },
  {
    q: "black shirt",
    exact: 0,
    similar: 0,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Sweatshirts", "T-Shirts", "Tank Tops"],
    },
    note: "new in 6.7.1: fallback Similar must stay exactly as before while metadata explains requested category",
  },
  {
    q: "white shirt",
    exact: 0,
    similar: 0,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Sweatshirts", "T-Shirts", "Tank Tops"],
    },
    note: "updated intentionally in 6.8: cross-branch leak fix excludes Sneakers from Similar; only in-subtree white tees remain",
  },
  {
    q: "men shirt",
    exact: 0,
    similar: 0,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Sweatshirts", "T-Shirts", "Tank Tops"],
    },
    note: "updated in 6.7.2 INTENTIONALLY: sibling substitution preserves explicit gender constraint (MEN-compatible siblings only)",
  },
  {
    q: "classic shirt",
    exact: 0,
    similar: 0,
    status: {
      requested: "Shirts",
      productCount: 0,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Sweatshirts", "T-Shirts", "Tank Tops"],
    },
    note: "new in 6.7.1: attribute+empty category still metadata-only",
  },
  {
    q: "t-shirt",
    exact: 12,
    similar: 0,
    struct: { category: "T-Shirts" },
    status: {
      requested: "T-Shirts",
      productCount: 12,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Shirts", "Sweatshirts", "Tank Tops"],
    },
    note: "new in 6.7.1: stocked category reports its own count and taxonomy siblings; re-based P1/P4 (+Square Neck Crisscross Active T-Shirt); PR2-F1 re-based: productCount 19->12 (demo t-shirts excluded)",
  },
  {
    q: "tank top",
    exact: 50,
    similar: 0,
    struct: { category: "Tank Tops" },
    status: {
      requested: "Tank Tops",
      productCount: 50,
      siblings: ["Blouses", "Button-Ups", "Cardigans", "Hoodies", "Jackets", "Jumpers", "Polos", "Shirts", "Sweatshirts", "T-Shirts"],
    },
    note: "new in 6.7.1: sibling list includes empty Shirts too - data first, merchandising later; PR2-F1 re-based: productCount 58->51 (demo tank tops excluded); F7-S2 re-based: 1 OOS tank excluded -> 51->50",
  },
  {
    q: "jeans",
    exact: 1,
    similar: 0,
    struct: { category: "Jeans" },
    status: {
      requested: "Jeans",
      productCount: 1,
      siblings: ["Cargo", "Chinos", "Joggers", "Leggings", "Shorts", "Socks", "Trousers", "Underwear"],
    },
    note: "PR2-F1 re-based: real catalog holds exactly 1 WOMEN jean (no MEN/UNISEX jeans) -> jeans 6->1; demo-denim excluded",
  },
  {
    q: "shoes",
    exact: 49,
    similar: 0,
    struct: { category: "Shoes" },
    status: {
      requested: "Shoes",
      productCount: 49,
      siblings: [],
    },
    note: "new in 6.7.1: top-level node has no parent hence no siblings; count = subtree products; re-based P1/P4 (mislabeled T-Shirt left the Shoes tree); PR2-F1 re-based: productCount 71->49 (demo shoes excluded)",
  },
  {
    q: "nike",
    exact: 1,
    similar: 0,
    status: null,
    note: "new in 6.7.1: brand-only query has no detected category -> categoryStatus stays null; PR2-F1 re-based: 9 of 10 Nike items were demo/placeholder (empty productUrl) -> nike 10->1, the sole real Nike is 'Nike Air Jordan 1 Red And Black'",
  },
];

const GENDER_COMPATIBILITY = {
  MEN: ["MEN", "UNISEX"],
  WOMEN: ["WOMEN", "UNISEX"],
  UNISEX: ["UNISEX"],
};

function attrsSignature(structuredQuery) {
  return structuredQuery.attributes
    .map((a) => `${a.attributeName}:${a.value}`)
    .sort()
    .join("|");
}

async function runCase(client, testCase) {
  const problems = [];
  const res = await client.fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(testCase.q)}`
  );

  if (res.status !== 200) {
    problems.push(`HTTP ${res.status}, expected 200`);
    return problems;
  }

  const data = await res.json();

  if (data.success !== true) {
    problems.push(`success=${data.success}, expected true`);
    return problems;
  }

  if (!Array.isArray(data.exactProducts)) {
    problems.push("exactProducts missing/not array");
    return problems;
  }

  if (!Array.isArray(data.similarProducts)) {
    problems.push("similarProducts missing/not array");
    return problems;
  }

  if (data.exactCount !== data.exactProducts.length) {
    problems.push(
      `exactCount(${data.exactCount}) != exactProducts.length(${data.exactProducts.length})`
    );
  }

  if (data.similarCount !== data.similarProducts.length) {
    problems.push(
      `similarCount(${data.similarCount}) != similarProducts.length(${data.similarProducts.length})`
    );
  }

  if (data.query !== testCase.q.trim()) {
    problems.push(`echoed query "${data.query}" != "${testCase.q.trim()}"`);
  }

  if (data.exactCount !== testCase.exact) {
    problems.push(`exactCount=${data.exactCount}, expected ${testCase.exact}`);
  }

  if (data.similarCount !== testCase.similar) {
    problems.push(
      `similarCount=${data.similarCount}, expected ${testCase.similar}`
    );
  }

  if (testCase.struct) {
    for (const field of ["brand", "category", "color", "size", "gender"]) {
      if (field in testCase.struct) {
        const actual = data.structuredQuery[field];
        if (actual !== testCase.struct[field]) {
          problems.push(
            `structured.${field}=${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.struct[field])}`
          );
        }
      }
    }

    if ("attributes" in testCase.struct) {
      const actualSig = attrsSignature(data.structuredQuery);
      const expectedSig = [...testCase.struct.attributes].sort().join("|");
      if (actualSig !== expectedSig) {
        problems.push(
          `structured.attributes=[${actualSig}], expected [${expectedSig}]`
        );
      }
    }
  }

  if ("status" in testCase) {
    const actual = data.categoryStatus ?? null;
    if (
      JSON.stringify(actual) !== JSON.stringify(testCase.status)
    ) {
      problems.push(
        `categoryStatus=${JSON.stringify(actual)}, expected ${JSON.stringify(testCase.status)}`
      );
    }
  }

  const allProducts = [...data.exactProducts, ...data.similarProducts];

  for (const product of allProducts) {
    if (typeof product.score !== "number" || Number.isNaN(product.score)) {
      problems.push(`${product.name}: invalid score ${product.score}`);
      break;
    }

    if (product.score < 0) {
      problems.push(`${product.name}: negative score ${product.score}`);
      break;
    }
  }

  for (let i = 1; i < data.exactProducts.length; i++) {
    const prev = data.exactProducts[i - 1];
    const curr = data.exactProducts[i];
    const reqGender = data.structuredQuery.gender;
    const genderKey = (g) =>
      reqGender === "MEN" || reqGender === "WOMEN" || reqGender === "KIDS"
        ? g === reqGender
          ? 0
          : 1
        : 0;

    if (genderKey(prev.gender) > genderKey(curr.gender)) {
      problems.push(
        "exact results violate gender-priority ordering (same-gender must precede UNISEX regardless of score)"
      );
      break;
    }

    if (
      genderKey(prev.gender) === genderKey(curr.gender) &&
      prev.score < curr.score
    ) {
      problems.push(
        "exact results not sorted by score descending within gender bucket"
      );
      break;
    }
  }

  for (let i = 1; i < data.similarProducts.length; i++) {
    if (
      data.similarProducts[i - 1].score < data.similarProducts[i].score
    ) {
      problems.push("similar results not sorted by score descending");
      break;
    }
  }

  const exactIds = new Set(data.exactProducts.map((p) => p.id));

  for (const product of data.similarProducts) {
    if (exactIds.has(product.id)) {
      problems.push(`${product.name}: appears in both exact and similar`);
      break;
    }
  }

  const requestedGender = data.structuredQuery.gender;

  if (requestedGender && GENDER_COMPATIBILITY[requestedGender]) {
    const allowed = GENDER_COMPATIBILITY[requestedGender];

    for (const product of allProducts) {
      if (!allowed.includes(product.gender)) {
        problems.push(
          `${product.name}: gender ${product.gender} leaks into ${requestedGender} search`
        );
        break;
      }
    }
  }

  for (const product of data.exactProducts) {
    if (product.exactMatch !== true) {
      problems.push(`${product.name}: exact flag not true`);
      break;
    }
  }

  return problems;
}

function shortLabel(q) {
  const trimmed = q.replace(/\s+/g, " ").trim();
  const visible =
    trimmed.length > 24 ? `${trimmed.slice(0, 21)}...` : trimmed || "<empty>";
  return JSON.stringify(visible);
}

async function main() {
  console.log(`Search Regression Suite`);
  console.log(`Target: ${BASE_URL}/api/search`);
  console.log(`Cases: ${CASES.length}\n`);

  let client;

  try {
    await fetch(`${BASE_URL}/api/search?q=ping`, { signal: AbortSignal.timeout(10000) });
    client = { fetch };
  } catch (error) {
    console.error(`FAIL: dev server unreachable at ${BASE_URL}`);
    console.error(`Start it first: npm run dev`);
    process.exit(1);
  }

  const failures = [];
  let passed = 0;

  for (let i = 0; i < CASES.length; i++) {
    const testCase = CASES[i];
    const label = `[${String(i + 1).padStart(2, "0")}] ${shortLabel(testCase.q)}`;

    try {
      const problems = await runCase(client, testCase);

      if (problems.length === 0) {
        passed++;
        console.log(`PASS ${label} (${testCase.exact}/${testCase.similar})`);
      } else {
        failures.push({ label, q: testCase.q, problems });
        console.log(`FAIL ${label}`);
        for (const problem of problems) {
          console.log(`       - ${problem}`);
        }
      }
    } catch (error) {
      failures.push({ label, q: testCase.q, problems: [error.message] });
      console.log(`FAIL ${label}`);
      console.log(`       - request error: ${error.message}`);
    }
  }

  console.log(`\n================ RESULT ================`);
  console.log(`${passed}/${CASES.length} passed`);

  if (failures.length > 0) {
    console.log(`\nFailed cases:`);
    for (const failure of failures) {
      console.log(`  ${failure.label}`);
      for (const problem of failure.problems) {
        console.log(`    - ${problem}`);
      }
    }
    process.exit(1);
  }
}

main();
