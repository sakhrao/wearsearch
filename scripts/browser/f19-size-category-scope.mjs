/* F19/F19b Size facet scope — deterministic browser regression.

   The Size facet must be built ONLY from the families and size
   systems carried by the CURRENT result products, never from the
   full catalog:
     - a shoes-only result (sneakers / heels / the single product
       boots) shows ONLY the shoe section(s) its products actually
       carry, and every chip is numeric;
     - today's live catalog has every AVAILABLE shoe variant on the
       US system (no EU-tracked available variant exists), so boots
       still exercises the single-product case and the EU side of
       the US/EU split is proven by the pure unit suite
       (scripts/size-sections.test.mts), not by live data;
     - a clothing-only result (blouses / jeans) shows ONLY "Clothing
       Size" chips, none numeric;
     - a genuinely mixed result (white) keeps ALL its families;
     - empty categories (shirts / belts / hats / formal shoes have
       no catalog products today) render NO Size facet at all — no
       cross-category sizes can leak.
   Also asserts the global facet invariant for size chips: no
   clickable chip has count 0, no disabled chip has count > 0.

   Requires the dev server on :3000 and a CDP chrome on :9222.
   Usage: node scripts/browser/f19-size-category-scope.mjs <page-ws-url> */
const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const m = ++id;
    pending.set(m, { resolve, reject });
    ws.send(JSON.stringify({ id: m, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expression) {
  const msg = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return msg.result?.result?.value;
}
async function waitFor(fn, timeout = 25000) {
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
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg);
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");

const NUMERIC = /^\d+(?:\.\d+)?$/;
const cards = () => ev(`document.querySelectorAll("article").length`);

/* F19b section labels (per-family Size sub-headings). */
const SECTIONS = [
  "Clothing Size",
  "Shoe Size (US)",
  "Shoe Size (EU)",
  "Accessories Size",
  "Headwear Size",
];

/* The Size panel: [{ label, chips: [{label, count, off}] }] */
const sizePanel = () => ev(`(() => {
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
        return { label: t.slice(0, o).trim(), count, off: btn.disabled };
      }),
    });
  }
  return sections;
})()`);

async function expectHeadings(query, expected) {
  await waitFor(() =>
    ev(`document.body.innerText.toUpperCase().includes("REFINE RESULTS")`)
  );
  const sections = await sizePanel();
  const actual = (sections ?? []).map((s) => s.label).sort();
  const want = [...expected].sort();
  check(
    `${query}: size sections exactly ${JSON.stringify(want)}`,
    JSON.stringify(actual) === JSON.stringify(want),
    `actual=${JSON.stringify(actual)}`
  );
  return sections ?? [];
}

async function assertChips(query, sections, mode) {
  const chips = sections.flatMap((s) =>
    s.chips.map((c) => ({ section: s.label, ...c }))
  );
  check(
    `${query}: Size panel has chips`,
    chips.length > 0,
    `chips=${chips.length}`
  );
  if (mode === "numeric") {
    const bad = chips.filter((c) => !NUMERIC.test(c.label));
    check(
      `${query}: every size chip is numeric (shoe-only)`,
      bad.length === 0,
      `non-numeric=${JSON.stringify(bad)}`
    );
  } else if (mode === "alpha") {
    const bad = chips.filter((c) => NUMERIC.test(c.label));
    check(
      `${query}: no numeric chip (clothing-only)`,
      bad.length === 0,
      `numeric=${JSON.stringify(bad)}`
    );
  }
  const zeroEnabled = chips.filter(
    (c) => c.count === 0 && c.off === false
  );
  const positiveDisabled = chips.filter(
    (c) => c.count !== null && c.count > 0 && c.off === true
  );
  check(
    `${query}: size invariant (no count-0 clickable, no disabled count>0)`,
    zeroEnabled.length === 0 && positiveDisabled.length === 0,
    `zeroEnabled=${JSON.stringify(zeroEnabled)} positiveDisabled=${JSON.stringify(positiveDisabled)}`
  );
}

/* --- shoes-only: q=sneakers (all-US live data, no EU leak) -------- */
await send("Page.navigate", { url: "http://localhost:3000/?q=sneakers" });
await waitFor(() => cards().then((n) => n >= 1));
await assertChips(
  "sneakers",
  await expectHeadings("sneakers", ["Shoe Size (US)"]),
  "numeric"
);

/* --- shoes-only US: q=heels -------------------------------------- */
await send("Page.navigate", { url: "http://localhost:3000/?q=heels" });
await waitFor(() => cards().then((n) => n >= 1));
await assertChips(
  "heels",
  await expectHeadings("heels", ["Shoe Size (US)"]),
  "numeric"
);

/* --- shoes-only single product: q=boots -------------------------- */
await send("Page.navigate", { url: "http://localhost:3000/?q=boots" });
await waitFor(() => cards().then((n) => n === 1));
await assertChips(
  "boots",
  await expectHeadings("boots", ["Shoe Size (US)"]),
  "numeric"
);

/* --- clothing-only: q=blouses (rich window) ---------------------- */
await send("Page.navigate", { url: "http://localhost:3000/?q=blouses" });
await waitFor(() => cards().then((n) => n === 30));
await assertChips("blouses", await expectHeadings("blouses", ["Clothing Size"]), "alpha");

/* --- clothing-only single result: q=jeans ------------------------ */
await send("Page.navigate", { url: "http://localhost:3000/?q=jeans" });
await waitFor(() => cards().then((n) => n === 1));
await assertChips("jeans", await expectHeadings("jeans", ["Clothing Size"]), "alpha");

/* --- legit mixed result: q=white --------------------------------- */
await send("Page.navigate", { url: "http://localhost:3000/?q=white" });
await waitFor(() => cards().then((n) => n >= 1));
const mixed = await expectHeadings("white", [
  "Clothing Size",
  "Shoe Size (US)",
]);
check(
  "white: mixed result keeps all its families, each non-empty",
  mixed.every((s) => s.chips.length > 0),
  JSON.stringify(mixed.map((s) => ({ label: s.label, chips: s.chips.length })))
);

/* --- empty categories: no catalog products ----------------------- */
for (const q of ["shirts", "belts", "hats", "formal shoes"]) {
  await send("Page.navigate", { url: `http://localhost:3000/?q=${encodeURIComponent(q)}` });
  await waitFor(() =>
    ev(`document.body.innerText.toUpperCase().includes("WHY IS THIS EMPTY?")`)
  );
  check(`${q}: zero result cards`, (await cards()) === 0, `cards=${await cards()}`);
  const panel = await sizePanel();
  const body = await ev(`document.body.innerText`);
  const leaked = SECTIONS.filter((l) => body.includes(l));
  check(
    `${q}: no Size facet rendered (no cross-category leak)`,
    panel === null &&
      leaked.length === 0 &&
      !body.includes("Refine results"),
    `panel=${JSON.stringify(panel)} leaked=${JSON.stringify(leaked)}`
  );
}

console.log(
  `F19 size-category-scope browser: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);