/* F18 search-bar re-run — deterministic browser regression for the
   Search Button fix in src/app/page.tsx.

   Root cause (proven read-only, HEAD 911d743): the F15-C2 defer fired
   whenever urlSearchKey differed from the last PROCESSED key. router.push
   used by the Search button settles through non-monotonic urlSearchKey
   re-commits (old -> new -> old -> ...), so the pre-push key re-appearing
   mid-load was misread as a new navigation and bumped the F11 epoch,
   discarding the bar search it had just launched; the OLD intent then
   re-executed and painted under the new URL. The fix anchors the defer to
   the urlSearchKey that was current when the search launched
   (searchStartUrlKeyRef), so only a genuinely different urlSearchKey
   defers, and guards the empty branch so a transient "/" re-commit cannot
   reset the in-flight search.

   R1  clothing -> dress via the bar: exactly one /api/search (dress),
       never a re-fired clothing; URL/input/results = dress; no stuck
       "Searching...".
   R2  clothing -> tops -> jeans: each intent runs once, previous intents
       never re-execute, final results match the final URL.
   R3  first search from a fresh "/": paints results with a single request.
   R4  F15 preserved: a REAL pushState to another intent during a held
       search defers it exactly once, the held response never paints, and
       the newest intent runs once after the search settles.

   Run: npx tsx scripts/browser/f18-search-bar-rerun.mjs <ws-url>
   against next dev + the CDP page target (fresh tab per run). */
const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;
let holdAll = false;
const held = [];
let apiLog = [];

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
  const msg = await send("Runtime.evaluate", { expression, returnByValue: true });
  return msg.result?.result?.value;
}
async function waitFor(fn, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(60);
  }
  throw new Error("timeout");
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg);
    return;
  }
  if (msg.method === "Fetch.requestPaused") {
    const { requestId, request } = msg.params;
    if (request.url.includes("/api/search")) {
      apiLog.push(request.url.slice(request.url.indexOf("?")));
      if (holdAll) held.push(requestId);
      else void send("Fetch.continueRequest", { requestId });
      return;
    }
    void send("Fetch.continueRequest", { requestId });
  }
};

const href = () => ev(`location.href`);
const inputVal = () =>
  ev(`(document.querySelector('input[aria-label="Search for clothes"]') || {}).value`);
const running = () => ev(`document.body.innerText.includes("Searching...")`);
const cards = () => ev(`document.querySelectorAll("article").length`);
const headerOf = () =>
  ev(`(() => {
    const el = [...document.querySelectorAll("p")].find(
      (x) => /\\d+ exact match(es)? found/.test((x.textContent || "").trim())
    );
    return el ? el.textContent.replace(/\\s+/g, " ").trim() : null;
  })()`);
const bodyText = () => ev(`document.body.innerText`);
const searchButtonsEnabled = () =>
  ev(`(() => { const b = document.querySelector('button[aria-label="Run search"]'); return b ? !b.disabled : false; })()`);
const typeInto = (text) =>
  ev(`(() => {
    const i = document.querySelector('input[aria-label="Search for clothes"]');
    if (!i) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
const clickSearch = () =>
  ev(`document.querySelector('button[aria-label="Run search"]').click(); true`);
const pushState = (url) =>
  ev(`history.pushState({}, "", ${JSON.stringify(url)}); true`);
const releaseAll = async () => {
  const ids = held.splice(0);
  holdAll = false;
  for (const requestId of ids) {
    await send("Fetch.continueRequest", { requestId });
  }
};
const apiQueries = () => apiLog.map((u) => u.split("&")[0]);

async function begin() {
  apiLog = [];
}

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");

/* ================= R1: clothing -> dress replaces exactly once ================= */
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*api/search*", requestStage: "Request" }],
});
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(async () => (await cards()) === 30 && !(await running()));
await sleep(300);

await begin();
await typeInto("dress");
await waitFor(searchButtonsEnabled, 15000);
await clickSearch();
await waitFor(async () =>
  (await href()).endsWith("/?q=dress") &&
    (await inputVal()) === "dress" &&
    !(await running()));
await sleep(600); /* give a stale re-fire any chance to appear */
const r1api = apiQueries();
check("R1 exactly one request fired, q=dress",
  r1api.length === 1 && r1api[0] === "?q=dress",
  JSON.stringify(apiLog));
check("R1 the old query is never re-run after the click",
  !apiLog.some((u) => u.startsWith("?q=clothing")),
  JSON.stringify(apiLog));
check("R1 URL/input/results = dress",
  (await href()).endsWith("/?q=dress") &&
    (await inputVal()) === "dress" &&
    (await cards()) === 0 &&
    (await headerOf()) === null,
  `url=${await href()} input=${await inputVal()} cards=${await cards()} header=${await headerOf()}`);
check("R1 no stuck Searching... / no stale clothing paint",
  !(await running()) &&
    !(await bodyText()).includes("30 exact matches found"),
  `running=${await running()}`);

/* ================= R2: clothing -> tops -> jeans, each once ================= */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(async () => (await cards()) === 30 && !(await running()));
await sleep(300);

await begin();
await typeInto("tops");
await waitFor(searchButtonsEnabled, 15000);
await clickSearch();
await waitFor(async () =>
  (await href()).endsWith("/?q=tops") &&
    (await inputVal()) === "tops" &&
    !(await running()));
await sleep(600);
const r2a = apiQueries();
check("R2 tops ran once (no previous intent re-execution)",
  r2a.length === 1 &&
    r2a[0] === "?q=tops" &&
    !apiLog.some((u) => u.startsWith("?q=clothing")),
  JSON.stringify(apiLog));

await begin();
await typeInto("jeans");
await waitFor(searchButtonsEnabled, 15000);
await clickSearch();
await waitFor(async () =>
  (await href()).endsWith("/?q=jeans") &&
    (await inputVal()) === "jeans" &&
    (await cards()) === 1 &&
    (await headerOf()) === "1 exact match found" &&
    !(await running()));
await sleep(600);
const r2b = apiQueries();
check("R2 jeans ran once (neither tops nor clothing re-executed)",
  r2b.length === 1 &&
    r2b[0] === "?q=jeans" &&
    !apiLog.some((u) =>
      u.startsWith("?q=clothing") || u.startsWith("?q=tops")),
  JSON.stringify(apiLog));
check("R2 final results match the final URL",
  (await href()).endsWith("/?q=jeans") &&
    (await cards()) === 1 &&
    (await headerOf()) === "1 exact match found" &&
    (await inputVal()) === "jeans",
  `url=${await href()} cards=${await cards()} header=${await headerOf()}`);

/* ================= R3: first search from a fresh "/" ================= */
await begin();
await send("Page.navigate", { url: "http://localhost:3000/" });
await waitFor(() => ev(`document.readyState === "complete"`));
await sleep(1500);
check("R3 home had no stray search requests",
  apiQueries().length === 0,
  JSON.stringify(apiLog));
await begin();
const ready = await (async () => {
  await typeInto("clothing");
  return waitFor(searchButtonsEnabled, 15000);
})();
check("R3 bar enabled after typing on home",
  ready,
  "button stayed disabled");
await clickSearch();
await waitFor(async () =>
  (await href()).endsWith("/?q=clothing") &&
    (await inputVal()) === "clothing" &&
    (await cards()) === 30 &&
    (await headerOf()) === "30 exact matches found" &&
    !(await running()));
await sleep(600);
const r3api = apiQueries();
check("R3 first search from / painted results with exactly one request",
  r3api.length === 1 &&
    r3api[0] === "?q=clothing" &&
    (await cards()) === 30 &&
    (await headerOf()) === "30 exact matches found",
  `api=${JSON.stringify(apiLog)} cards=${await cards()} header=${await headerOf()}`);
check("R3 no duplicate/no reset from the home-search race",
  r3api.filter((u) => u === "?q=clothing").length === 1,
  JSON.stringify(apiLog));

/* ================= R4: F15 protection preserved ================= */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(async () => (await cards()) === 30 && !(await running()));
await sleep(300);
apiLog = [];

holdAll = true;
await send("Fetch.enable", {
  patterns: [{ urlPattern: "*api/search*", requestStage: "Request" }],
});
await typeInto("jeans");
await waitFor(searchButtonsEnabled, 15000);
await clickSearch();               /* A: jeans, held */
check("R4 the held search is in flight",
  apiQueries().includes("?q=jeans") && (await running()),
  `api=${JSON.stringify(apiLog)} running=${await running()}`);
await pushState("/?q=dress");      /* genuine navigation B mid-load */
await sleep(400);
await releaseAll();                /* A's response must be discarded */
check("R4 held A (jeans) never paints after release",
  (await bodyText()).includes("1 exact match found") === false,
  `body=${(await bodyText()).slice(0, 400)}`);
await waitFor(async () =>
  (await href()).endsWith("/?q=dress") &&
    (await inputVal()) === "dress" &&
    !(await running()));
await sleep(600);
const r4api = apiQueries();
check("R4 exactly one B (dress) execution after the deferral",
  r4api.filter((u) => u === "?q=dress").length === 1,
  JSON.stringify(apiLog));
check("R4 B's results painted under the new URL",
  (await cards()) === 0 &&
    (await headerOf()) === null &&
    (await href()).endsWith("/?q=dress"),
  `cards=${await cards()} header=${await headerOf()} url=${await href()}`);
check("R4 A never re-executed; nothing leftover",
  !apiLog.some((u) => u.startsWith("?q=clothing")) &&
    apiQueries().filter((u) => u === "?q=jeans").length === 1,
  JSON.stringify(apiLog));
await send("Fetch.disable");

console.log(
  `F18 search-bar rerun (R1-R4): ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);