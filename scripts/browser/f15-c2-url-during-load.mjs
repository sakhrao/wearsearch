/* F15-C2 url-during-load — deterministic browser regression for
   the approved C2 fix in src/app/page.tsx.

   The URL effect used to record lastUrlSearchKeyRef BEFORE calling
   handleSearch, so a URL change while a search was in flight was
   marked "resolved" even though handleSearch bailed on `loading`:
   the old response then painted under the new URL and the new
   intent was silently dropped forever. The fix defers the new
   intent - it bumps the F11 epoch (stale-in-flight -> rejected)
   and lets the effect re-run once loading ends.

   R1  URL change during loading -> the new intent auto-runs after
       the current search settles (no lost intent), and is not
       launched prematurely while the old request is still held.
   R2  the new intent executes exactly once.
   R3  no old results remain once the new intent completes.
   R4  a stale response is rejected by F11 (zero stale paint) and
       the deferred intent always launches.
   R5  back() (same-document popstate) while loading preserves the
       intent without loss or double-run.
   R6  several URL changes during loading -> only the LAST intent
       executes.

   Run: npx tsx scripts/browser/f15-c2-url-during-load.mjs <ws-url>
   against next dev + the CDP page target. */
const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;
let holdAll = false;
const holdTargets = new Set();
const held = [];
const seen = [];
const counts = { clothing: 0, tops: 0, shoes: 0, jeans: 0 };

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
  });
  return msg.result?.result?.value;
}
async function waitFor(fn, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(100);
  }
  throw new Error("timeout");
}
const qOf = (url) => new URL(url).searchParams.get("q");
const firstAlt = () => ev(`(document.querySelector("article img") || {}).alt || null`);
const bodyText = () => ev(`document.body.innerText`);
const inputVal = () => ev(`(document.querySelector('input[aria-label="Search for clothes"]') || {}).value`);
const searching = () => ev(`document.body.innerText.includes("Searching...")`);
const cards = () => ev(`document.querySelectorAll("article").length`);
const loadState = (n) => ev(`document.querySelectorAll("article").length >= ${n} && !document.body.innerText.includes("Searching...")`);
const clickSearch = () => ev(`(() => {
  const b = [...document.querySelectorAll("button")].find(
    (x) => (x.innerText || "").trim() === "Search"
  );
  if (b) b.click();
  return true;
})()`);
const pushState = (url) => ev(`history.pushState({}, "", ${JSON.stringify(url)}); true`);
const goBack = () => ev(`history.back(); true`);
const reset = () => {
  seen.length = 0;
  held.length = 0;
  for (const k of Object.keys(counts)) counts[k] = 0;
  holdAll = false;
  holdTargets.clear();
};
const releaseAll = async () => {
  const ids = held.splice(0);
  holdAll = false;
  for (const requestId of ids) {
    await send("Fetch.continueRequest", { requestId });
  }
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(new Error(msg.error.message));
    } else {
      resolve(msg);
    }
    return;
  }
  if (msg.method === "Fetch.requestPaused") {
    const { requestId, request } = msg.params;
    const url = request.url;
    if (url.includes("/api/search")) {
      const q = qOf(url);
      seen.push(url);
      if (q) counts[q] += 1;
      if (holdAll || (q !== null && holdTargets.has(q))) {
        held.push(requestId);
      } else {
        void send("Fetch.continueRequest", { requestId });
      }
      return;
    }
    void send("Fetch.continueRequest", { requestId });
  }
};

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");
await send("Fetch.enable", {
  patterns: [
    { urlPattern: "http://localhost:3000/api/search*", requestStage: "Request" },
  ],
});

/* ================= R1-R3: clothing -> tops during loading ================= */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(() => loadState(30));
const clothingFirst = await firstAlt();

reset();
holdAll = true;
await clickSearch();                       /* clothing search, held */
await waitFor(() => searching());
await pushState("/?q=tops");               /* new intent while loading */
await sleep(500);
const heldSeen = [...seen];                /* must NOT contain tops yet */

await releaseAll();
await waitFor(() => counts.tops >= 1, 20000);
await waitFor(() => ev(`!document.body.innerText.includes("Searching...")`));
await sleep(150);
const r1 = await firstAlt();
const r1Body = await bodyText();
const r1Input = await inputVal();
check("R1 new intent is deferred while the old request is held",
  !heldSeen.some((u) => qOf(u) === "tops"),
  `heldSeen=${heldSeen.map(qOf).join(",")}`);
check("R1 new intent auto-runs exactly once after the search settles",
  counts.tops === 1,
  `tops=${counts.tops}`);
check("R1 URL/input reflect the new intent",
  r1Input === "tops",
  `input=${r1Input}`);
check("R2 the new intent executes exactly once",
  counts.clothing === 1 && counts.tops === 1,
  `clothing=${counts.clothing} tops=${counts.tops}`);
check("R3 old results are gone once the new intent completes",
  r1 !== clothingFirst && !r1Body.includes("Blue & Black Check Shirt"),
  `firstAlt=${r1} clothingFirst=${clothingFirst}`);

/* ============ R4: stale response rejected (F11 epoch intact) ============ */
await send("Page.navigate", { url: "http://localhost:3000/?q=xyzzy" });
/* wait for the EXECUTED empty state: the search must have been
   launched and settled (input reflects the query), not merely the
   first paint before the URL effect ran */
await waitFor(() => ev(`(document.querySelector('input[aria-label="Search for clothes"]') || {}).value === "xyzzy" && document.querySelectorAll("article").length === 0 && !document.body.innerText.includes("Searching...")`));

/* the shoes payload the page WOULD paint if F11 let it through */
const shoesRef = await (async () => {
  const j = await (await fetch("http://localhost:3000/api/search?q=shoes&limit=30&offset=0")).json();
  return j.exactProducts?.[0]?.name ?? null;
})();

reset();
holdAll = true;
await pushState("/?q=shoes");              /* starts the shoes search */
await waitFor(() => searching());
await pushState("/?q=jeans");              /* deferred while shoes is loading */
await sleep(500);
const r4HeldSeen = [...seen];              /* shoes only, never jeans */

holdTargets.add("jeans");                  /* deterministic: hold the jeans launch */
await releaseAll();                        /* release shoes: F11 must reject it */
await waitFor(() => held.length >= 1, 20000);   /* jeans now held */
const midSamples = [];
for (let i = 0; i < 4; i += 1) {
  midSamples.push(await cards());
  await sleep(15);
}
await releaseAll();
await waitFor(() => loadState(1));
const r4 = await firstAlt();
const r4Body = await bodyText();
const r4Input = await inputVal();
check("R4 the stale shoes response is rejected: zero stale paint",
  midSamples.every((c) => c === 0) &&
    !r4Body.includes(shoesRef) &&
    r4 !== shoesRef,
  `mid=${midSamples.join(",")} shoesRef=${shoesRef} firstAlt=${r4}`);
check("R4 the deferred intent is never lost",
  counts.shoes === 1 && counts.jeans === 1 && r4Input === "jeans",
  `shoes=${counts.shoes} jeans=${counts.jeans} input=${r4Input}`);
check("R4 the intermediate intent was not launched",
  !r4HeldSeen.some((u) => qOf(u) === "jeans") &&
    !r4HeldSeen.some((u) => qOf(u) === "clothing") &&
    r4HeldSeen.length === 1,
  `heldSeen=${r4HeldSeen.map(qOf).join(",")}`);

/* ============ R5: back() during loading (same-document) ============ */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(() => loadState(30));
const clothingFirstBack = await firstAlt();
await pushState("/?q=shoes");              /* same-document popstate entry */
await waitFor(() => loadState(30));

reset();
holdAll = true;
await clickSearch();                       /* shoes search, held */
await waitFor(() => searching());
await goBack();                            /* popstate back to clothing */
await sleep(500);
const r5HeldSeen = [...seen];              /* no clothing yet */

await releaseAll();
await waitFor(() => counts.clothing >= 1, 20000);
await waitFor(() => loadState(30));
const r5 = await firstAlt();
check("R5 back() defers the intent until the old request settles",
  !r5HeldSeen.some((u) => qOf(u) === "clothing") &&
    counts.clothing === 1 &&
    counts.shoes === 1,
  `heldSeen=${r5HeldSeen.map(qOf).join(",")} clothing=${counts.clothing} shoes=${counts.shoes}`);
check("R5 the restored intent paints the restored query's results",
  r5 === clothingFirstBack,
  `firstAlt=${r5} back=${clothingFirstBack}`);

/* ============ R6: tops -> jeans before the request completes ============ */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(() => loadState(30));

reset();
holdAll = true;
await clickSearch();                       /* clothing search, held */
await waitFor(() => searching());
await pushState("/?q=tops");               /* first drop */
await sleep(180);
await pushState("/?q=jeans");              /* second drop, last wins */
await sleep(500);
const r6HeldSeen = [...seen];

await releaseAll();
await waitFor(() => counts.jeans >= 1, 20000);
await waitFor(() => loadState(1));
const r6 = await firstAlt();
await waitFor(() => ev(`!document.body.innerText.includes("Searching...")`));
check("R6 only the LAST deferred intent executes",
  r6HeldSeen.length === 1 &&
    counts.tops === 0 &&
    counts.jeans === 1,
  `heldSeen=${r6HeldSeen.map(qOf).join(",")} tops=${counts.tops} jeans=${counts.jeans}`);
check("R6 the last intent paints",
  r6 !== clothingFirst,
  `firstAlt=${r6} clothing=${clothingFirst}`);

console.log(
  `F15-C2 url-during-load: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);