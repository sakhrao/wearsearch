# FitWear — Responsive UX Pass + Mobile Questionnaire Report

Scope: presentation/layout only. No canonical-size architecture, taxonomy
structure, questionnaire business logic, search-URL contract, or catalog data
was changed. Stage J remains closed/blocked; no Stage L started.

## 1. Files changed

Presentation only:

- `src/app/globals.css` — phone wizard flow, sticky action bar, step slide.
- `src/components/find-questionnaire.tsx` — step direction, slide transition,
  sticky actions, touch/label polish.
- `src/components/home-page.tsx` — edge padding, hero/main gutters, empty-state
  padding.
- `src/components/site-header.tsx` — mobile gutter.
- `src/components/site-footer.tsx` — mobile gutters (2 containers).
- `src/components/static-page.tsx` — mobile gutter.
- `src/components/category-spotlight.tsx` — banner gutter/gap.
- `src/components/outfit-promo.tsx` — banner gutter.
- `src/app/build/page.tsx` — page gutter.
- `src/app/outfit/outfit-client.tsx` — page gutter.
- `src/app/product/[productId]/page.tsx` — page gutter + long listing id wrap.

Encoding-only (source characters, previously applied in this pass):

- `src/components/find-questionnaire.tsx`
- `src/components/home-page.tsx`
- `src/lib/sizes.ts`

## 2. Problems found and fixed

- **Corrupted characters in source.** `find-questionnaire.tsx` carried
  `EF BF BD 1D` (U+FFFD U+001D) where an em dash was intended, plus mangled
  `…`, curly quotes and `≈`; `home-page.tsx` / `sizes.ts` carried CP1252
  mojibake (`â€"`, `Â§`). Fixed at the source and verified by codepoint scan —
  no U+FFFD/U+001D/U+2B1D/U+2B26/U+00C2/U+00E2 remain. `Hermès` (legitimate)
  untouched.
- **Nested scroll on phones.** The questionnaire used a fixed
  `height: calc(100svh - var(--nav-h))` window at every width, trapping
  phones in a small internal scroller.
- **320px gutters.** Root containers used `px-6` (24px/side), over-squeezing
  320px panels; empty-state cards used `p-10`.
- **No directional step cue.** Steps swapped via a fade-up only.
- **Long listing ids** could force horizontal scroll on the product page.

## 3. Mobile questionnaire UX changes

- **Natural flow on phones.** Below the `sm` breakpoint `.wizard-window` and
  `.wizard-card` relax to `height: auto; overflow: visible`, so the page
  scrolls instead of a nested region. Tablet/desktop keep the single-screen
  wizard.
- **Sticky thumb bar.** The Back / Skip / Continue / "See my matches" row is
  `position: sticky; bottom: 0` on phones (`.wizard-actions`), above the home
  indicator via `env(safe-area-inset-bottom)`, then returns to a plain
  in-flow row from 640px up.
- **Step carousel cue.** Added `direction` state; forward steps slide in from
  the trailing edge, Back slides in from the leading edge
  (`.step-slide-next` / `.step-slide-prev`, 0.3s). Disabled under
  `prefers-reduced-motion`.
- **Touch/label polish.** `OptionCard` now `px-4 sm:px-5`, centered, with
  `min-w-0 break-words` so long labels never overflow; expanded category grid
  tightens to `gap-3` on phones.

Layout sequence stays data-driven from the existing taxonomy/questionnaire
logic. Only the *motion direction* is new UI state; answers, branching, URL
contract and restore/edit are untouched.

## 4. Tests executed

- `npm run typecheck` — PASS.
- `npm run build` — PASS (15/15 static pages).
- `npm run test:questionnaire` — 32/32.
- `npm run test:url-state` — 29 passed, 0 failed.
- `npm run test:edit-restore` — 36 passed, 0 failed.
- `npm run test:size-domain-h2` — 24/24.
- `npm run test:taxonomy` — 83/87 (known baseline T1/T2/T-kids/B1).
- `npm run test:size-domain-k-source-contract` — 18/18.
- `eslint` on all changed files — no new errors/warnings (2 pre-existing
  `react-hooks` errors + `<img>` warnings in `home-page.tsx`).

## 5. Remaining / deliberately deferred

- **Manual multi-viewport pass** (320/375/390/430/768/1024/1280/1440) was not
  run: no browser automation (Playwright/Puppeteer/CDP) is installed in this
  environment. Verification was static reasoning + production build.
- **Option-level horizontal carousels** (colors / detail chips) were not
  forced. The color step already has a search filter and wrapping pills,
  which is more usable than a scroller; per the brief, a slider is a means,
  not the goal.
- **Swipe/drag gesture** on the step carousel was not added; button + animated
  transition keeps keyboard and touch parity.
- **Dev-server suites** (`test:search`, `test:e2e`, outfit/facet suites) remain
  un-runnable locally (ECONNREFUSED 127.0.0.1:3000) — environment limitation,
  not a regression.
- `docs/UI-PHASE-REPORT.md` residual encoding corruption intentionally left
  (documentation, outside the public-UI edit scope).
