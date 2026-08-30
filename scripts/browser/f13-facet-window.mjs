/* F13-1 window-scoped facet counts — deterministic browser
   regression for the approved (A) outcome: facet ids restored
   on the wire (brand.id / category.id) + counts scoped to the
   loaded window.

   q=clothing, ranked envelope of 517 exact (first occurrences:
   Tank Tops at rank 101, i.e. page 4).

   BEFORE the F9/F13 fix:
     - brand/category chips carried full-set counts but matched
       on undefined ids -> ANY brand/category click returned 0
       results + "No products match your filters" dead end.
   AFTER the fix:
     1. In-window value (Brand "Casual Comfort", rank<=30) is
        enabled with its real window count and a click shows the
        matching product.
     2. Out-of-window value (Category "Tank Tops", rank>30) is
        "(0)" + disabled and clicking it is a no-op.
     3. Loading more pages recomputes counts client-side; Tank
        Tops becomes enabled with count>=1 once loaded.
     4. Structural invariant: every enabled facet chip has a
        count > 0 and every count-0 chip is disabled — no
        clickable chip can ever empty the page.

   Run against the dev server + the CDP Chrome endpoint. */
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
  throw new Error("timeout");
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

const cards = () => ev(`document.querySelectorAll("article").length`);

/* find a facet chip by panel label and text fragment -> {t, off, count} */
const chip = (panelLabel, frag) => ev(`(() => {
  const p = [...document.querySelectorAll("p")].find(
    (x) => (x.textContent || "").trim() === ${JSON.stringify(panelLabel)}
  );
  if (!p) return null;
  const wrap = p.closest("div");
  const b = [...wrap.querySelectorAll("button")].find(
    (el) => (el.innerText || "").includes(${JSON.stringify(frag)})
  );
  if (!b) return null;
  const t = b.innerText.trim();
  const o = t.lastIndexOf("(");
  let count = null;
  if (o >= 0 && t.endsWith(")")) {
    const digits = t.slice(o + 1, t.length - 1);
    if (/^[0-9]+$/.test(digits)) count = Number(digits);
  }
  return { t, off: b.disabled, count };
})()`);

const clickChip = (panelLabel, frag) => ev(`(() => {
  const p = [...document.querySelectorAll("p")].find(
    (x) => (x.textContent || "").trim() === ${JSON.stringify(panelLabel)}
  );
  const wrap = p.closest("div");
  const b = [...wrap.querySelectorAll("button")].find(
    (el) => (el.innerText || "").includes(${JSON.stringify(frag)})
  );
  if (b) b.click();
  return true;
})()`);

const clearFilters = () => ev(`(() => {
  const b = [...document.querySelectorAll("button")].find(
    (el) => (el.innerText || "").trim() === "Clear filters"
  );
  if (b) b.click();
  return true;
})()`);

await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(() => cards().then((n) => n === 30));

/* (1) in-window brand value is enabled with its real window count */
const cc = await chip("Brand", "Casual Comfort");
check(
  "in-window brand: Casual Comfort enabled with count>=1",
  cc !== null && cc.off === false && cc.count !== null && cc.count >= 1,
  JSON.stringify(cc)
);

await clickChip("Brand", "Casual Comfort");
await waitFor(() => cards().then((n) => n === 1));
const clickState = await ev(`(() => {
  const text = document.querySelector("main").innerText || "";
  return {
    noMatch: text.includes("No products match your filters"),
    firstCard: document.querySelector("article")?.innerText?.slice(0, 60) ?? "",
  };
})()`);
check(
  "in-window brand: selecting it shows the matched product",
  clickState.noMatch === false &&
    clickState.firstCard.toLowerCase().includes("casual"),
  JSON.stringify(clickState)
);
await clearFilters();
await waitFor(() => cards().then((n) => n === 30));

/* (2) out-of-window category value is (0) + disabled + a no-op */
const tank1 = await chip("Category", "Tank Tops");
check(
  "out-of-window category: Tank Tops shows (0) + disabled",
  tank1 !== null && tank1.off === true && tank1.count === 0,
  JSON.stringify(tank1)
);
await clickChip("Category", "Tank Tops");
await sleep(400);
check(
  "out-of-window category: clicking the disabled chip is a no-op",
  (await cards()) === 30,
  `cards=${await cards()}`
);

/* (3) Load-more pages -> counts recompute client-side, no re-search */
for (let i = 0; i < 3; i += 1) {
  await ev(`(() => {
    const b = [...document.querySelectorAll("button")].find(
      (el) => (el.innerText || "").includes("Load more exact matches")
    );
    if (b) b.click();
    return true;
  })()`);
  await waitFor(() => cards().then((n) => n === 30 * (i + 2)));
}
const tank2 = await chip("Category", "Tank Tops");
check(
  "after load-more: Tank Tops becomes selectable with count>=1",
  tank2 !== null && tank2.off === false && tank2.count !== null && tank2.count >= 1,
  JSON.stringify(tank2)
);
await clickChip("Category", "Tank Tops");
await waitFor(() => ev(`document.querySelectorAll("article").length`).then((n) => n >= 1));
const tankState = await ev(`(() => {
  const text = document.querySelector("main").innerText || "";
  return {
    cards: document.querySelectorAll("article").length,
    noMatch: text.includes("No products match your filters"),
  };
})()`);
check(
  "after load-more: selecting Tank Tops shows >=1 product, no dead end",
  tankState.cards >= 1 && tankState.noMatch === false,
  JSON.stringify(tankState)
);
await clearFilters();
await waitFor(() => cards().then((n) => n === 120));

/* (4) structural invariant over every rendered facet chip */
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
})()`);
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
  "invariant: count-0 chips are disabled, enabled chips count>0",
  invariantOk && invariant.length > 0,
  `${weird} (chips scanned=${invariant.length})`
);

console.log(
  `F13 window-facets browser: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);