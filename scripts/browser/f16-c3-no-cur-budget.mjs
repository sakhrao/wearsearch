/* F16-C3 no-cur-budget — deterministic browser regression for the
   approved C3 fix in src/lib/search-url.ts.

   A budget URL without cur (e.g. ?q=dress&min=50&max=150) must have
   a deterministic meaning: the display values ARE the engine bounds
   in EUR, regardless of the fx availability. The old default was
   fx-dependent (EUR while the rate was null, then re-interpreted as
   USD the moment /api/meta arrived) which produced a second search
   with converted bounds and a silent currency flip in the UI.

   R1  fresh page: the no-cur budget URL performs exactly ONE
       /api/search carrying priceMin=50&priceMax=150 (the display
       values, unconverted) and never any other bounds.
   R2  a second full navigation (rate now in client cache) resolves
       the SAME URL to the SAME single search with the SAME bounds:
       the meaning does not depend on lazy-load state.
   R3  no wait-fx surface ever appears (no "Looking up the exchange
       rate", no failure block) and the budget is displayed in EUR.

   Run: npx tsx scripts/browser/f16-c3-no-cur-budget.mjs <ws-url>
   against next dev + the CDP page target (fresh tab per run). */
const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;
const searches = [];
const bodySamples = [];

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
const pOf = (url, key) => new URL(url).searchParams.get(key);
const inputVal = () => ev(`(document.querySelector('input[aria-label="Search for clothes"]') || {}).value`);
const budgetText = () => ev(`(() => {
  const p = [...document.querySelectorAll("p")].find(
    (x) => (x.textContent || "").trim().startsWith("Budget:")
  );
  return p ? p.textContent.trim() : null;
})()`);
const running = () => ev(`document.body.innerText.includes("Searching...")`);
const settled = async () =>
  (await budgetText()) !== null && !(await running());
const locationHref = () => ev(`location.href`);

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
    if (request.url.includes("/api/search")) {
      searches.push(request.url);
    }
    void send("Fetch.continueRequest", { requestId });
  }
};

/* observe a no-cur budget page until it settles, then hold the
   observation window so a hypothetical fx-triggered second search
   (the pre-fix behavior) cannot be missed */
async function observeNoCurBudget() {
  for (let i = 0; i < 40; i += 1) {
    bodySamples.push(await ev(`document.body.innerText`));
    await sleep(100);
    if (await settled()) {
      await sleep(2000);
      return;
    }
  }
  throw new Error("did not settle");
}

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");
const marks = await send("Page.addScriptToEvaluateOnNewDocument", {
  source: "window.__c3Runs = (window.__c3Runs || 0) + 1;",
});
await send("Fetch.enable", {
  patterns: [
    { urlPattern: "http://localhost:3000/api/search*", requestStage: "Request" },
  ],
});

/* ================= R1: fresh page, one search, EUR bounds ================= */
await send("Page.navigate", {
  url: "http://localhost:3000/?q=dress&min=50&max=150",
});
await observeNoCurBudget();
const r1Input = await inputVal();
const r1Budget = await budgetText();
const r1Href = await locationHref();
const r1Bounds = searches.map((u) => `${pOf(u, "priceMin")}/${pOf(u, "priceMax")}`);

check("R1 exactly one search request",
  searches.length === 1,
  `searches=${searches.length} bounds=${r1Bounds.join(" , ")}`);
check("R1 engine bounds are the display values, unconverted",
  searches.length === 1 &&
    pOf(searches[0], "priceMin") === "50" &&
    pOf(searches[0], "priceMax") === "150",
  `bounds=${r1Bounds.join(" , ")}`);
check("R1 no other bounds ever observed",
  r1Bounds.every((b) => b === "50/150") && r1Bounds.length > 0,
  `bounds=${r1Bounds.join(" , ")}`);
check("R1 query restored into the input",
  r1Input === "dress",
  `input=${r1Input}`);
check("R1 budget is displayed in EUR",
  r1Budget === "Budget: 50 - 150 EUR",
  `budget=${r1Budget}`);
check("R1 URL is left unchanged (no cur injected)",
  r1Href.endsWith("/?q=dress&min=50&max=150"),
  `href=${r1Href}`);

/* ========= R2: repeat on a second navigation (rate now cached) ========= */
searches.length = 0;
await send("Page.navigate", {
  url: "http://localhost:3000/?q=dress&min=50&max=150",
});
await observeNoCurBudget();
const r2Input = await inputVal();
const r2Budget = await budgetText();
const r2Bounds = searches.map((u) => `${pOf(u, "priceMin")}/${pOf(u, "priceMax")}`);
check("R2 second navigation: still exactly one search",
  searches.length === 1,
  `searches=${searches.length} bounds=${r2Bounds.join(" , ")}`);
check("R2 the meaning does not depend on the fx availability",
  searches.length === 1 &&
    pOf(searches[0], "priceMin") === "50" &&
    pOf(searches[0], "priceMax") === "150" &&
    r2Budget === "Budget: 50 - 150 EUR" &&
    r2Input === "dress",
  `bounds=${r2Bounds.join(" , ")} budget=${r2Budget} input=${r2Input}`);

/* ======================= R3: no wait-fx surface ======================= */
const allText = bodySamples.join("\n");
check("R3 no wait-fx text ever appears",
  !allText.includes("Looking up the exchange rate") &&
    !allText.includes("Couldn't load the exchange rate"),
  `samples=${bodySamples.length}`);
check("R3 budget always rendered in EUR on both navigations",
  r1Budget === "Budget: 50 - 150 EUR" &&
    r2Budget === "Budget: 50 - 150 EUR",
  `r1=${r1Budget} r2=${r2Budget}`);

console.log(
  `F16-C3 no-cur-budget: ${passed} passed, ${failed} failed`
);
void marks;
ws.close();
process.exit(failed > 0 ? 1 : 0);