# WearSearch — Public-Facing UI Refinement Report

Date: 2026-09-02 · Next.js 16.3.2, Tailwind v4 (CSS-first), Prisma
Phases: (1) Homepage Redesign — completed & verified; (2) Public-copy / UX refinement — completed & verified;
(3) Find / Questionnaire redesign + visual identity — completed & verified (this report covers all three).

## 1. What this phase changed

Rewrote every public-facing string so WearSearch reads as a polished commercial fashion product.
Search, Outfits, API, catalog, and commerce logic were untouched; all frozen suites' literal
assertions (listed below) survive verbatim.

- Hero → **single-headline** (`text-4xl sm:text-6xl` Fraunces, semibold): "Find exactly what you're looking for." + short subline + big sticky search bar (magnifier, `h-14 rounded-full`, `aria-label="Search for clothes"` kept, placeholder "What are you looking for?") + example-search chips under it (`HERO_EXAMPLES`, verified live queries: black sneakers, white tank top, hoodie, cardigan, jeans, sandals — no fabricated counts) + "Not sure what to search? Use the find guide →".
- "How it works" → 3 steps, `01 Describe / 02 Refine / 03 Discover`, all user-facing copy.
- "Explore by style" → categories region (`id="discover"`, scroll anchor); title "Find styles you love"; removed "real canonical categories / real product counts".
- "Trending finds" / "Discover something you'll love" → featured products; removed `productStoreLabel` hostname (livostyle.net) from public cards (home + featured).
- Value promise → pillars "Search by description / Shop from trusted stores / Results that fit" — no backend/catalog/checkout language anywhere.
- Outfit promo → "Complete the look." + primary "Build an outfit" CTA; secondary "Answer a few questions" (find quiz) kept with lighter weight.
- Nav → Search / Discover (`/#discover`) / Outfits + desktop "Start searching" CTA (scrolls to + focuses the search input). Mobile hamburger unchanged (verified `#mobile-nav`).
- Footer → tagline "Find what fits your style." + links Search / Discover / Outfits / How it works; legal links kept; © line is user-facing.
- Results identity → visible `h1` with the query + "{n} results" count line; loading line "Finding your matches…" + non-`article` skeleton cards (pending contract: landing still has **zero** `<article>`/`<section>`); kept "N exact matches found", "Showing X of Y exact matches", "Search interpreted as", "Load more exact matches", "Why is this empty?", "No products match your filters", "Clear filters", fx blocks (untouched).
- Empty states → "We couldn't find the right match." + "Try changing your color, size, or search terms."; CTAs "Edit search" + "Start a new search" (new `handleStartNewSearch`); "We don't currently carry …s".
- ProductCard restyle → `aspect-[4/5]` image with hover scale, brand eyebrow, line-clamped name, category, gender pill, color dots/sizes/attribute chips, price, primary accent "View product" pill + secondary outline "Style this item" (href `/outfit?anchor=…` kept — `article` element + `innerText` semantics preserved for f13/f18/ux-outfit).
- Find quiz → "Skip" → "Skip for now" (Phase 2 step; fully superseded by the Phase 3 redesign below).
- `loading.tsx` sr text → "Finding your matches…"; error/not-found copy already user-facing (not-found dev line "The catalogue has everything…" removed).

New files: none. Removed: `src/components/popular-searches.tsx` (example chips now live under the hero search bar).

## 2. Design system (`globals.css`)

Premium limited palette — background off-white, near-black text, muted secondary, ONE accent
(brushed) burgundy:

- `--paper #faf6f0`, `--surface #fffdf9`, `--ink #211d19`, `--ink-soft #4f4a44`, `--ink-faint #857c6f`,
  `--accent #833338`, `--accent-deep #5f242a`, `--accent-tint #f4e9e6`, `--line #e6ded0`.
- Typography hierarchy: hero 48–64px (Fraunces), section 32–40px, card 16–18px, body 14–16px.
- Added `.skeleton` shimmer keyframes (disabled under `prefers-reduced-motion`).
- Focus rings, `::selection`, skip-link, hero + reveal keyframes, light-only theme unchanged.

## 3. Files changed / added

- Changed: `src/components/home-page.tsx`, `how-it-works.tsx`, `discovery-categories.tsx`,
  `featured-products.tsx`, `value-promise.tsx`, `outfit-promo.tsx`, `site-nav.tsx`, `site-footer.tsx`,
  `src/app/globals.css`, `src/app/{loading,not-found}.tsx`, `src/app/find/page.tsx`.
- Deleted: `src/components/popular-searches.tsx`.
- Untouched (frozen contracts): `src/lib/*`, `src/app/api/*`, `src/app/outfit/page.tsx`, currency/fx blocks in `home-page.tsx`.

## 4. Hard copy invariants preserved (browser suites assert these)

- Exactly one `input[aria-label="Search for clothes"]`; exactly one `button[aria-label="Run search"]`; idle text `Search`, loading `Searching...` (ASCII dots).
- Landing still has **zero** `<article>` and **zero** `<section>`; landing blocks are `div[role="region"]` (`aria-labelledby` ids: `how-it-works-title`, `browse-categories-title`, `featured-catalog-title`, `outfit-promo-title`).
- Results are the only `article`s; search-result cards keep `innerText.trim() === "Style this item"` links with `/outfit` + `anchor=` hrefs; outfit page `h1` stays "Style this item".
- Empty/copy literals: "No products match your filters", "Clear filters", "WHY IS THIS EMPTY?" (uppercase), "REFINE RESULTS" / "Refine results", "Load more exact matches", "Loading more…", "{n} exact match(es) found".
- fx block strings "exchange rate", "Retry", "Looking up the exchange rate…", "Couldn't load the exchange rate" + `Budget: {min} - {max} {CUR}` chip format — untouched.

## 5. Animations

`.hero-animate` entrance (fade/rise); `.reveal` IntersectionObserver fade-up below fold; card hover scales/translate; skeleton shimmer; all disabled under `prefers-reduced-motion`.

## 6. Responsiveness

CDP-verified (390×844 mobile emulation + 1440×900 desktop): **no horizontal overflow** on home,
results ("black sneakers"), mobile home, mobile results ("hoodie") (`scrollWidth === clientWidth`);
mobile nav opens full `#mobile-nav` link panel (Search / Discover / Outfits).

## 7. Accessibility

Skip link; `aria-labelledby` regions; `aria-current="page"` in nav; `aria-expanded`/`aria-controls` on
menu button; `aria-live="polite"` on the loading line; semantic heading order; visible focus rings;
`prefers-reduced-motion` support.

## 8. Performance

No new content lengthens the page (hero chips replace a whole default heroes block); server
route streams pre-rendered landing; no layout thrash; images lazy `loading="lazy"`.

## 9. Verification (this phase)

- `npx tsc --noEmit`: clean. `npx eslint src/**/*.{ts,tsx}`: **0 errors, 27 warnings** (all pre-existing).
- Browser suites (CDP, `localhost:3000`): **F13 7/7, F14 7/7, F15 12/12, F16 10/10, F17 8/8, F18 16/16,
  F20 21/21, ux-outfit-verification 42/42**.
- Dedicated refinement verification (temp script): landing 0 `article`/0 `section`; landing anchors
  present; eyebrow/hero/chips/button/placeholder copy correct; 6 example chips; no backend/catalog
  language anywhere in `body.innerText`; results identity `h1` = query + count line; "Style this item"
  href on every card; overflow checks at 1440×900 + 390×844 (home, results, mobile nav, mobile results);
  **0 console errors/warnings**. Accent button renders burgundy `rgb(131, 51, 56)` (= `#833338`).
- Frozen non-browser spot-check (post-change): spec-e2e 35/35, url-state 29/29, ranking 11/11,
  f9 8/8 — all match baseline.

Fresh screenshots (`wearsearch-screenshots/`): `desktop-home-r2`, `desktop-results-black-sneakers-r2`-equivalent
(`mobile-nav-r2`, `mobile-results-r2` from the refine run).

## 10. Regression status (unchanged drift — NOT rebaselined)

| Suite | Baseline | Now | Reason |
|---|---|---|---|
| search (non-browser) | 67/115 | 67/115 | drift |
| f6 / f6-attributes / f7 / f8 / f10 / similar-ratio / gender-policy / facet-policy | drift as captured | unchanged | drift |
| f11 race-guard (browser) | FAIL | FAIL | hardcoded literal "Showing 30 of 411 exact matches"; live `q=tops` = 416 |
| f12 fx-lazy (non-browser) | 8/8 at capture | 6/8 | count literals `clothing`=517 vs 523, `tops`=411 vs 416 |
| f19 size-category-scope (browser) | 2 fail | 2 fail | live catalog now carries EU shoe-size variants (sneakers: 115 EU + 115 US) |
| ranking, catalog-integrity, currency, f9, r8, g1, o4, outfit-api, outfit-prefs, spec-e2e, gender-order, questionnaire, facet-counts, edit-restore, diagnostics, rc2, url-state | all green | all green | — |

All drift failures are stale literal counts/segment expectations vs. the grown live catalog — they
predate this phase and are unrelated to the UI. No test files were modified; **no rebaseline performed**.

## 11. Limitations & notes

- The review model cannot render screenshots; layout/copy verification is DOM/computed-style based.
- One false-negative in the ad-hoc color check (test regex) — rendered accent is verified as `#833338`.
- F11/F12/F19 remain failing on count literals only; they were left untouched per the no-rebaseline rule.

---

## 12. Phase 3 — Find / Questionnaire redesign + visual identity

Turns the quiz into a guided fashion-shopping flow and states the Search-vs-Find split explicitly.
UI/UX only: `/api/search`, search logic, Outfit Engine, catalog, providers, normalization, ranking,
DB schema untouched; no baselines modified.

### What changed
- **CTAs.** Navbar desktop CTA is now an accent pill `Find your match` → `/find` (replaces scroll-to-search);
  nav links stay Search `/` / Discover `/#discover` / Outfits `/outfit`. Homepage adds an always-visible
  secondary button under the search bar — `Find your match` (outline, h-11) with caption only on landing
  ("Know exactly what you want? Use the search bar above. Prefer a nudge? Let us narrow it down.").
  The search bar keeps its frozen `aria-label="Search for clothes"` / "Search" button, so the hero primary
  button label did **not** become "Search products" — Search=search bar, Find=quiz.
- **Questionnaire flow (rewritten `src/app/find/page.tsx`).** Six conversation-style steps with a per-step
  question `h1` + one-line supporting hint:
  1. What are you shopping for? / 2. Who is it for? / 3. Which colors do you like?
  4. What size do you need? / 5. What's your budget? / 6. Anything else that matters?
- **Progress.** Slim header "← Search" + "Your preferences" eyebrow; "Step X of 6" text + `role="progressbar"`
  accent fill → minimal, professional.
- **Option controls.** `OptionCard` (category/gender: `rounded-2xl` tiles) and `OptionPill` (colors/sizes,
  `rounded-full`) with `aria-pressed`. Selected = accent border + `--accent-tint` background + check glyph
  + near-black text (never color-only); unselected = neutral border/surface with quiet hover. Category grid
  is grouped under silent group headings; step 3 has a color search filter input.
- **Bottom nav.** Back (left; hidden+disabled on step 1), one consistent **Continue** label (right), and a
  distinct tertiary "Skip for now" on optional steps 3–6 that skips without selecting. Continue is disabled
  until the step is answerable; required steps 1–2 never show Skip.
- **Rewarding finish.** Step 6 shows a check-mark banner "We've got your preferences." / "Let's find
  something you'll love." and the primary CTA becomes "See my matches →" (disabled only if the intent can't
  build); submit navigates to `/` with the built search query string (same `buildIntent` as before).
- **Budget step.** Two accent range sliders (`aria-label` "Minimum/Maximum budget in {CUR}") with live
  readouts; captions reworded to user voice (USD budgets state the live ECB fuel rate + date; EUR budgets
  state no conversion is needed) — fx logic, chip format, and the frozen fx error strings on the results
  page are untouched.
- **Motion.** `@keyframes step-in` (fade + 12px rise, `both`) applied via `.step-animate`; disabled under
  `prefers-reduced-motion`. Card hover lift + `active:scale` pressed feedback.
- **Buttons.** PRIMARY = accent pill (Continue / See my matches / Find your match); SECONDARY = neutral
  outline; TERTIARY = quiet text (Skip for now).

### Hard contracts held (frozen suites / prior behavior)
- 6 steps/order, `REQUIRED_STEPS` = category + gender; gender offers **Women / Men / Kids** only
  (`isValidGender("unisex") === false`, so the spec example Unisex was intentionally not added);
  `GENDER_LABELS` map, ids `find-search-text`/`find-color-filter`, sessionStorage key
  `wearsearch-find-answers`, R8 size-token handling, contextual size sections, budget FX + edit-restore
  all preserved verbatim.
- `productStoreLabel` stays exported in `src/lib/product-url.ts` (catalog-integrity asserts it) but is not
  displayed in public cards.

### Verification (Phase 3)
- `npx tsc --noEmit`: clean; `eslint`: 0 errors, 27 pre-existing warnings (unchanged).
- Ad-hoc CDP walk-through `verify-find.mjs`: **59/59** — all 6 steps on 1440×900 desktop AND 390×844
  mobile; progress bar step counts; required steps have no Skip; optional steps Skip without selecting;
  Continue gate disabled→enabled; Back visible+enabled from step 2; budget readouts update; last-step CTA
  "See my matches →" → results URL with `?q=`; touch targets ≥ 44px at every step; no horizontal overflow;
  **0 console errors/warnings**.
- Browser suites re-run after the find/CTA work (all CDP): **F13 7/7, F14 7/7, F15 12/12, F16 10/10,
  F17 8/8, F18 16/16, F20 21/21, ux-outfit 42/42**; F19 28/2 — same two pre-existing EU-shoe-size drift
  fails as before.
- Frozen non-browser spot-checks (post-change): questionnaire 32/32, url-state 29/29, spec-e2e 35/35 —
  all match baseline.
- Selection visuals verified via computed styles (not pixels): selected card `aria-pressed=true`,
  `background rgb(244,233,230)` = `--accent-tint`, `border rgb(131,51,56)` = `--accent`, ink text, check
  SVG visible.
- Screenshots (DOM-snapshot technique, since headless `Page.captureScreenshot` can return a stale frame
  after in-page mutations): `find-r/` — steps 1 (plain + selected), 3, 5, 6 on desktop; steps 1/3/5 on
  mobile 390px; plus `home-find-cta-{desktop,mobile}.png` showing the Find CTA under the search bar.

### Regression status (Phase 3)
Same drift table as §10; F19's 2 fails are unchanged (catalog carries EU shoe sizes). F11/F12 count
literals unchanged. **No test files modified, no rebaseline** — all failures are pre-existing literal
count/segment drift vs. the grown live catalog.
---

## Phase 4-A: Outfit Engine Functional Improvement Phase (7 additive gaps)

Closed the 7 approved gap features on top of the existing working outfit engine. All engine changes
are additive; the frozen builder/scoring/compatibility paths are untouched, and none of the frozen
outfit suites required a rebaseline.

### Features shipped (all verified end-to-end)
1. **Size awareness** - /api/outfits (POST) now accepts size (e.g. "M" or "42") and echoes it back
   in equest.size. The catalog loader now selects variant size { system, value, normalizedValue,
   productType } from ProductVariant -> Size. A new deterministic matcher evalSize
   (src/lib/outfit/outfit-size.ts) ranks candidates: AVAILABLE exact size (1.0) > exact-any (0.7) >
   equivalent-numeric (0.7) > no structured data (0.5, graceful) > no match (0.2). When no size is
   given, candidate ordering is byte-identical to the size-unaware path.
2. **Add / Remove item** - the active look is now client-editable. Remove drops a slot (count decreases,
   total recomputed, slot flagged missing); *"+ Add an item"* re-fills the first empty slot via the
   existing replace API.
3. **Total / remaining / over display** - refinable budget shows exact remaining if under, red over-run if
   over: "�X under budget" / "�X over budget" / "On budget".
4. **Budget presets before build** - chips �100 / �150 / �200 / �300 + Custom number input in the refine bar.
5. **"Not my style"** - per-item replace variant. eplaceSlot gains additive excludeProductIds (and
   optional excludeSimilar); the replace API parses excludeProductIds. The rejected product id is
   never re-picked; current locked items are also excluded defensively.
6. **"N of N pieces" completion phrasing** - "3 of 4 pieces � Partial outfit" in the look header.
7. **Save / Share** - Save writes the full outfit to sessionStorage (key wearsearch-outfit-saved);
   Share writes a shareable URL to sessionStorage (key wearsearch-outfit-share-url) and attempts a
   non-blocking clipboard write. Sharing uses a new additive lockProductIds field on the build route:
   uildOutfits gains lockProducts that pre-place items into their natural slots and fills only the
   remaining slots, so an exact look is reconstructible from the URL alone.

### Engine additions (all additive, none break frozen behavior)
- src/lib/outfit/types.ts - variant size shape; OutfitRequest.size, OutfitRequest.lockProductIds.
- src/lib/outfit/catalog.ts - select + map variant size.
- src/lib/outfit/outfit-size.ts - NEW pure evalSize matcher.
- src/lib/outfit/candidate-generator.ts - optional size on candidatesForSlot; size-aware stable sort.
- src/lib/outfit/outfit-builder.ts - BuilderOptions.size & lockProducts; ReplaceOptions.size,
  excludeProductIds, excludeSimilar; threads size through pools/optional attachment; fills required
  slots minus locked under full-lock reconstruction.
- src/app/api/outfits/route.ts - parse/forward size, lockProductIds.
- src/app/api/outfits/replace/route.ts - parse/forward size, excludeProductIds.
- src/app/outfit/page.tsx - UI for all 7 gaps. h1 stays "Style this item"; first h2 stays the anchor
  name; item cards keep div[class*='overflow-hidden'] + first-span slot label + a "Replace"/"Swapping�"
  button; Shop-the-Look details string unchanged.

### Verification (Phase 4-A)
- Frozen outfit engine suites (no rebaseline): slots 24/24, scoring 10/10, category 289/289,
  color 28/28, style 13/13, prefs 77/77, insufficient 9/9, replace 47/47, integration 67/67,
  api 101/101, o4-equivalence 149/149 - all green.
- NEW engine suites: scripts/outfit-size.test.mts 10/10, scripts/outfit-interactive.test.mts 8/8,
  scripts/outfit-save-share.test.mts 6/6.
- 
px tsc --noEmit clean; eslint 0 errors (only pre-existing warnings, unchanged).
- Browser: frozen ux-outfit-verification.mjs **42/42** on the rebuilt page; new CDP walk
  outfit-phase-verification.mjs **23/23** covering size input+API echo, Add/Remove counts, budget
  preset click + under/over line, "N of N pieces", "Not my style" item swap, Save payload, Share URL +
  engine/browser reconstruction of the exact shared look, no console errors.

### Regression status (Phase 4-A)
Same drift-only failures as before (search/f6-f12/f19-variants etc. reason on live-catalog literal
counts, EU shoe sizes). No test files modified, no rebaseline. New test files added only.
