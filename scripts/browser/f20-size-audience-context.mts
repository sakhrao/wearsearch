/* F20 Stage 3-B size-context browser regression.

   End-to-end binding of the Refine Size facet to the contextual
   identity pipeline (audience | productType | system | value):

     1. For a set of live intents, the rendered Size chips and their
        counts MUST equal exactly what the pure pipeline computes
        from the SAME envelope products the page loaded
        (buildSizeSectionColumns + countProductsForFacetValue over
        an empty filter set). No chip may come from outside the
        currently-loaded products, and no count may lie.
     2. Clicking a size chip keeps exactly the products the
        predicate keeps (the card count equals the pure predicted
        count), with no dead end.
     3. The global facet invariant holds for every rendered chip
        (no count-0 chip is clickable, no disabled chip has count>0).

   Requires the dev server on :3000 and a CDP chrome on :9222.
   Usage: npx tsx scripts/browser/f20-size-audience-context.mts
          <page-ws-url> */

import {
  SIZE_SECTION_LABELS,
  SIZE_SECTION_ORDER,
  buildSizeSectionColumns,
} from "../../src/lib/size-sections";
import {
  countProductsForFacetValue,
  type ActiveFacetFilters,
  type FacetProduct,
} from "../../src/lib/search-facets";

const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

function send(method: string, params: Record<string, unknown> = {}) {
  return new Promise((resolve, reject) => {
    const m = ++id;
    pending.set(m, { resolve, reject });
    ws.send(JSON.stringify({ id: m, method, params }));
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ev(expression: string): Promise<unknown> {
  const msg = (await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { result?: { value?: unknown } } };
  return msg.result?.result?.value;
}
async function waitFor(fn: () => Promise<unknown>, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(200);
  }
  throw new Error("waitFor timeout");
}
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data as string);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg);
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");

const cards = () => ev(`document.querySelectorAll("article").length`);

const SECTIONS = [
  "Clothing Size",
  "Shoe Size (US)",
  "Shoe Size (EU)",
  "Accessories Size",
  "Headwear Size",
];

/* [ { label, chips: [{value, count, off}] } ] per Size panel */
type SizePanelSection = {
  label: string;
  chips: { value: string; count: number | null; off: boolean }[];
};

const sizePanelDom = (): Promise<SizePanelSection[] | null> =>
  ev(`(() => {
  const p = [...document.querySelectorAll("p")].find(
    (x) => (x.textContent || "").trim() === "Size"
  );
  if (!p) return null;
  const wrap = p.closest("div");
  const sections = [];
  const labels = ${JSON.stringify(SECTIONS)};
  for (const h of wrap.querySelectorAll("p")) {
    const label = (h.textContent || "").trim();
    if (!labels.includes(label)) continue;
    const block = h.closest("div");
    sections.push({
      label,
      chips: [...block.querySelectorAll("button")].map((btn) => {
        const t = btn.innerText.trim();
        const o = t.lastIndexOf("(");
        let count = null;
        if (o >= 0 && t.endsWith(")")) {
          const d = t.slice(o + 1, t.length - 1);
          if (/^[0-9]+$/.test(d)) count = Number(d);
        }
        return { value: t.slice(0, o).trim(), count, off: btn.disabled };
      }),
    });
  }
  return sections;
})()`) as Promise<SizePanelSection[] | null>;

const EMPTY: ActiveFacetFilters = {
  gender: new Set(),
  category: new Set(),
  color: new Set(),
  size: new Set(),
  brand: new Set(),
};

type ApiProduct = {
  gender: string | null;
  category: { id: string; name: string };
  brand: { id: string; name: string };
  variants: {
    color: { id: string; name: string } | null;
    size: { value: string; system: string } | null;
  }[];
};

async function expectedFromEnvelope(intent: string) {
  const res = await fetch(
    `http://localhost:3000/api/search?q=${encodeURIComponent(intent)}`
  );
  const data = (await res.json()) as {
    exactProducts: ApiProduct[];
    similarProducts: ApiProduct[];
  };
  const pool: FacetProduct[] = [
    ...(data.exactProducts ?? []),
    ...(data.similarProducts ?? []),
  ].map((p) => ({
    gender: p.gender,
    category: p.category,
    brand: p.brand,
    variants: p.variants.map((v) => ({
      color: v.color ? { id: v.color.id, name: v.color.name } : null,
      size: v.size
        ? { value: v.size.value, system: v.size.system ?? null }
        : null,
    })),
  }));

  const columns = buildSizeSectionColumns(pool);
  const bySection = new Map<string, Map<string, number[]>>();

  for (const key of SIZE_SECTION_ORDER) {
    const sectionChips = columns[key].flatMap((c) => c.chips);
    if (sectionChips.length === 0) continue;
    const label = SIZE_SECTION_LABELS[key];
    const groups = new Map<string, number[]>();
    for (const chip of sectionChips) {
      const count = countProductsForFacetValue(
        "size",
        chip.identity,
        EMPTY,
        pool
      );
      const list = groups.get(chip.value) ?? [];
      list.push(count);
      groups.set(chip.value, list);
    }
    bySection.set(label, groups);
  }

  const envelopeSize =
    (data.exactProducts?.length ?? 0) +
    (data.similarProducts?.length ?? 0);
  return { pool, bySection, envelopeSize };
}

const shrunk = (groups: Map<string, number[]>) =>
  JSON.stringify(
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => [k, [...v].sort((a, b) => a - b)])
  );

const clearFilters = () => ev(`(() => {
  const b = [...document.querySelectorAll("button")].find(
    (el) => (el.innerText || "").trim() === "Clear filters"
  );
  if (b) b.click();
  return true;
})()`);

const INTENTS = ["t-shirt", "sneakers", "heels", "boots"];

for (const intent of INTENTS) {
  const expected = await expectedFromEnvelope(intent);
  const envelope = expected.envelopeSize;

  await send("Page.navigate", {
    url: `http://localhost:3000/?q=${encodeURIComponent(intent)}`,
  });

  if (envelope > 0) {
    await waitFor(() => cards().then((n) => n === envelope));
  } else {
    await waitFor(() =>
      ev(`document.body.innerText.toUpperCase().includes("WHY IS THIS EMPTY?")`)
    );
  }

  const rawPanel = await ev(`(() => {
    const p = [...document.querySelectorAll("p")].find(
      (x) => (x.textContent || "").trim() === "Size"
    );
    if (!p) return "NO SIZE P";
    const wrap = p.closest("div");
    return {
      ps: [...wrap.querySelectorAll("p")].map((x) => (x.textContent || "").trim()),
      btns: [...wrap.querySelectorAll("button")].map((b) => b.innerText.trim()),
    };
  })()`);
  const dom = (await sizePanelDom()) ?? [];
  check(
    `${intent}: size panel present`,
    rawPanel !== "NO SIZE P" && rawPanel !== null,
    JSON.stringify(rawPanel)
  );
  const actualBySection = new Map<string, Map<string, number[]>>();
  for (const section of dom) {
    const groups = new Map<string, number[]>();
    for (const chip of section.chips) {
      if (chip.count === null) continue;
      const list = groups.get(chip.value) ?? [];
      list.push(chip.count);
      groups.set(chip.value, list);
    }
    actualBySection.set(section.label, groups);
  }

  check(
    `${intent}: DOM section labels equal pipeline sections`,
    JSON.stringify([...actualBySection.keys()].sort()) ===
      JSON.stringify([...expected.bySection.keys()].sort()),
    `dom=${JSON.stringify([...actualBySection.keys()])} expected=${JSON.stringify([...expected.bySection.keys()])}`
  );

  let equal = true;
  let detail = "";
  for (const [label, groups] of expected.bySection) {
    if (shrunk(actualBySection.get(label) ?? new Map()) !== shrunk(groups)) {
      equal = false;
      detail = `${label}: dom=${shrunk(actualBySection.get(label) ?? new Map())} expected=${shrunk(groups)}`;
    }
  }
  check(
    `${intent}: every rendered size chip + count equals the pure pipeline`,
    equal,
    detail
  );

  if (dom.length > 0) {
    /* click a chip whose (value, count) is unique across the panel */
    let target: { value: string; count: number } | null = null;
    const occurrences = new Map<string, { value: string; count: number }>();
    const counts = new Map<string, number>();
    for (const section of dom) {
      for (const chip of section.chips) {
        if (chip.count === null || chip.off) continue;
        const tag = `${section.label}|${chip.value}|${chip.count}`;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
        occurrences.set(tag, { value: chip.value, count: chip.count });
      }
    }
    for (const [tag, n] of counts) {
      if (n === 1) {
        target = occurrences.get(tag) ?? null;
        break;
      }
    }

    if (target) {
      const targetText = `${target.value} (${target.count})`;
      const clicked = await ev(`(() => {
        const p = [...document.querySelectorAll("p")].find(
          (x) => (x.textContent || "").trim() === "Size"
        );
        const wrap = p.closest("div");
        const b = [...wrap.querySelectorAll("button")].find(
          (el) => (el.innerText || "").trim() === ${JSON.stringify(targetText)}
        );
        if (b) b.click();
        return b !== undefined;
      })()`);
      check(
        `${intent}: found the unique size chip to click`,
        clicked === true,
        JSON.stringify(target)
      );

      const afterClickCards = await waitFor(
        () => cards().then((n) => n === target!.count),
        15000
      ).catch(() => "TIMEOUT");
      const noMatch = await ev(
        `(document.querySelector("main")?.innerText || "").includes("No products match your filters")`
      );
      check(
        `${intent}: clicking size "${target.value}" keeps exactly ${target.count} product(s)`,
        afterClickCards !== "TIMEOUT" && noMatch === false,
        `cards=${String(afterClickCards)} noMatch=${Boolean(noMatch)}`
      );

      await clearFilters();
      if (envelope > 0) {
        await waitFor(() => cards().then((n) => n === envelope));
      }
    }
  }
}

/* global facet invariant over every rendered chip */
type FacetChipRow = {
  t: string;
  off: boolean;
  count: number | null;
};
const invariant = await ev(`(() => {
  const labels = ["Gender", "Category", "Color", "Size", "Brand"];
  const chips = [];
  for (const label of labels) {
    const p = [...document.querySelectorAll("p")].find(
      (x) => (x.textContent || "").trim() === label
    );
    if (!p) continue;
    const wrap = p.closest("div");
    for (const b of wrap.querySelectorAll("button")) {
      const t = b.innerText.trim();
      const o = t.lastIndexOf("(");
      let count = null;
      if (o >= 0 && t.endsWith(")")) {
        const digits = t.slice(o + 1, t.length - 1);
        if (/^[0-9]+$/.test(digits)) count = Number(digits);
      }
      chips.push({ t, off: b.disabled, count });
    }
  }
  return chips;
})()`) as FacetChipRow[];

let invariantOk = true;
let weird = "";
for (const chipRow of invariant) {
  if (chipRow.count === null) {
    if (chipRow.off === false) {
      invariantOk = false;
      weird = `enabled chip without a count: ${chipRow.t}`;
    }
    continue;
  }
  if (chipRow.count === 0 && chipRow.off === false) {
    invariantOk = false;
    weird = `clickable chip with count 0: ${chipRow.t}`;
  }
  if (chipRow.count > 0 && chipRow.off === true) {
    invariantOk = false;
    weird = `disabled chip with count >0: ${chipRow.t}`;
  }
}
check(
  "invariant: count-0 chips disabled, enabled chips count>0",
  invariantOk && invariant.length > 0,
  `${weird} (chips scanned=${invariant.length})`
);

console.log(
  `F20 size-context browser: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);