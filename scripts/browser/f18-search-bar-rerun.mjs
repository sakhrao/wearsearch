/* F18 search-bar re-run — deterministic browser regression for the
   approved fix in src/app/page.tsx.

   Editing the search bar after a search and running again used to
   leave the PREVIOUS results on screen. Root cause: the URL effect,
   re-running while `loading` flipped, hit the F15-C2 defer for the
   OLD urlSearchKey while the Search button's own push was still
   landing. That bump of the F11 epoch invalidated the NEW search's
   in-flight response; once the navigation applied, the effect
   matched lastUrlSearchKeyRef and early-returned, so nothing
   re-executed and the old results stayed under the new query.

   The fix scopes the F15-C2 defer to a REAL URL change (urlSearchKey
   differs from the last processed one AND the parsed intent is not
   the in-flight search), so the button/Enter path's own churn never
   invalidates its own search.

   R1  re-running with new text replaces old results; URL, input and
       results all reflect the new query.
   R2  a second re-run replaces again (no accumulation, no stale).
   R3  after an F15-style held interleave, a bar re-run still lands on
       the bar query's final results.

   Run: npx tsx scripts/browser/f18-search-bar-rerun.mjs <ws-url>
   against next dev + the CDP page target (fresh tab per run). */
const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;
let holdAll = false;
const held = [];
const seen = [];

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

const href = () => ev(`location.href`);
const inputVal = () =>
  ev(`(document.querySelector('input[aria-label="Search for clothes"]') || {}).value`);
const running = () => ev(`document.body.innerText.includes("Searching...")`);
const cards = () => ev(`document.querySelectorAll("article").length`);
const firstAlt = () =>
  ev(`(document.querySelector("article img") || {}).alt || null`);
const bodyText = () => ev(`document.body.innerText`);
const settled = async (minCards = 1) =>
  (await cards()) >= minCards && !(await running());
const setInput = (text) =>
  ev(`(() => {
    const i = document.querySelector('input[aria-label="Search for clothes"]');
    if (!i) return false;
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
const clickSearch = () =>
  ev(`(() => {
    const b = document.querySelector('button[aria-label="Run search"]');
    if (b) b.click();
    return true;
  })()`);
const pushState = (url) =>
  ev(`history.pushState({}, "", ${JSON.stringify(url)}); true`);
const releaseAll = async () => {
  const ids = held.splice(0);
  holdAll = false;
  for (const requestId of ids) {
    await send("Fetch.continueRequest", { requestId });
  }
};
const headerOf = async () =>
  ev(`(() => {
    const el = [...document.querySelectorAll("p")].find(
      (x) => /^\\d+ exact match(es)? found/.test((x.textContent || "").trim())
    );
    return el ? el.textContent.replace(/\\s+/g, " ").trim() : null;
  })()`);

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
      seen.push(request.url);
      if (holdAll) held.push(requestId);
      else void send("Fetch.continueRequest", { requestId });
      return;
    }
    void send("Fetch.continueRequest", { requestId });
  }
};

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");

const api = async (q) => {
  const j = await (await fetch(
    `http://localhost:3000/api/search?q=${encodeURIComponent(q)}&debug=1`
  )).json();
  return j;
};
const jeans = await api("jeans");
const dress = await api("dress");
const jeansCount = jeans.exactCount ?? 0;
const dressCount = dress.exactCount ?? 0;
const jeansHeader =
  jeansCount === 1
    ? "1 exact match found"
    : `${jeansCount} exact matches found`;
/* A query with zero exact matches renders no N-found paragraph at
   all — only the "No exact matches found" empty state. */
const dressHeader =
  dressCount > 0
    ? dressCount === 1
      ? "1 exact match found"
      : `${dressCount} exact matches found`
    : null;

/* ================= R1: clothing -> jeans replaces ================= */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(async () => (await cards()) === 30 && !(await running()));
const clothingFirst = await firstAlt();

await setInput("jeans");
await sleep(100);
await clickSearch();
await waitFor(async () =>
  (await href()).endsWith("/?q=jeans") &&
    (await inputVal()) === "jeans" &&
    (await settled(jeansCount > 0 ? 1 : 0)) &&
    !(await running()));
const r1Href = await href();
const r1Val = await inputVal();
const r1Header = await headerOf();
check("R1 URL reflects the new query",
  r1Href.endsWith("/?q=jeans"),
  `href=${r1Href}`);
check("R1 input reflects the new query",
  r1Val === "jeans",
  `input="${r1Val}"`);
check("R1 results replaced (jeans header, trailing counts gone)",
  jeansCount > 0
    ? r1Header === jeansHeader && (await cards()) === jeansCount
    : r1Header === jeansHeader && (await cards()) === 0,
  `header="${r1Header}" feared=${jeansHeader} cards=${await cards()}`);
check("R1 old clothing results are gone",
  (await firstAlt()) !== clothingFirst &&
    !(await bodyText()).includes("Showing 30 of"),
  `first=${await firstAlt()} clothingFirst=${clothingFirst}`);

/* ================= R2: jeans -> dress replaces again ================= */
await setInput("dress");
await sleep(100);
await clickSearch();
await waitFor(async () =>
  (await href()).endsWith("/?q=dress") &&
    (await inputVal()) === "dress" &&
    !(await running()) &&
    (dressCount > 0 ? (await cards()) >= dressCount : (await cards()) === 0));
await sleep(250);
const r2Href = await href();
const r2Val = await inputVal();
const r2Header = await headerOf();
check("R2 second re-run updates the URL",
  r2Href.endsWith("/?q=dress"),
  `href=${r2Href}`);
check("R2 input tracks the new text",
  r2Val === "dress",
  `input="${r2Val}"`);
check("R2 results replaced again, never accumulated",
  (dressCount > 0
    ? r2Header === dressHeader && (await cards()) === dressCount
    : r2Header === null && (await cards()) === 0),
  `header="${r2Header}" feared=${dressHeader} cards=${await cards()}`);
check("R2 nothing from the previous run remains",
  !(await bodyText()).includes(jeansHeader),
  `staleHeader=${jeansHeader}`);

/* ============ R3: held interleave then a bar re-run ============ */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await waitFor(async () => (await cards()) === 30 && !(await running()));

seen.length = 0;
holdAll = true;
await send("Fetch.enable", {
  patterns: [
    { urlPattern: "*api/search*", requestStage: "Request" },
  ],
});
await setInput("tops");
await sleep(100);
await clickSearch();               /* tops held */
await waitFor(() => running());
await pushState("/?q=jeans");      /* F15-style URL change mid-load */
await sleep(400);
await releaseAll();                /* tops rejected by F11 epoch */
await waitFor(async () =>
  (await href()).endsWith("/?q=jeans") &&
    (await inputVal()) === "jeans" &&
    !(await running()));
await sleep(250);
const r3AfterInterleaveHeader = await headerOf();
check("R3 deferred intent executed exactly once after F15 interleave",
  (await inputVal()) === "jeans" &&
    r3AfterInterleaveHeader === jeansHeader,
  `header="${r3AfterInterleaveHeader}" feared=${jeansHeader}`);

await setInput("dress");
await sleep(100);
await clickSearch();               /* the repaired bar path */
await waitFor(async () =>
  (await href()).endsWith("/?q=dress") &&
    (await inputVal()) === "dress" &&
    !(await running()));
await sleep(250);
const r3Header = await headerOf();
check("R3 bar re-run after the interleave lands on its own results",
  (dressCount > 0
    ? r3Header === dressHeader && (await cards()) === dressCount
    : r3Header === null && (await cards()) === 0) &&
    !(await bodyText()).includes(jeansHeader),
  `header="${r3Header}" feared=${dressHeader} cards=${await cards()}`);
await send("Fetch.disable");

console.log(
  `F18 search-bar rerun: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);