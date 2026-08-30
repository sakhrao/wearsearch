/* F14-C1 wait-fx meta-failure — deterministic browser regression
   for the approved C1 fix in src/app/page.tsx.

   A USD budget URL cannot resolve until the fx rate arrives
   (parseSearchUrl -> "wait-fx"), and the rate only comes from
   the single /api/meta fetch on mount. Before the fix a meta
   failure was swallowed (.catch(() => {})) so the page froze
   forever: no results, no error, no retry.

   Deterministic setup: every /api/meta request is answered with
   HTTP 500 while /api/search is never touched until the script
   releases the endpoint and clicks the app's Retry button.

   T1  error block + Retry button, query preserved, no results.
   T2  zero /api/search calls while the rate is unavailable.
   T3  after Retry exactly one search with the converted
       priceMin = usdToEur(50, liveRate).
   T4  error block gone, results render, URL unchanged.
   T5  cur=EUR path unaffected by a failing meta endpoint.

   Run: npx tsx scripts/browser/f14-c1-meta-failure.mjs <ws-url>
   against next dev + the CDP Chrome endpoint. */
import { usdToEur } from "../../src/lib/currency";

const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let passed = 0;
let failed = 0;
let stubMode = "fail";
const metaRequests = [];
const searchRequests = [];

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
    if (url.includes("/api/meta")) {
      metaRequests.push(url);
      if (stubMode === "fail") {
        void send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 500,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from('{"success":false}').toString("base64"),
        });
      } else {
        void send("Fetch.continueRequest", { requestId });
      }
      return;
    }
    if (url.includes("/api/search")) {
      searchRequests.push(url);
    }
    void send("Fetch.continueRequest", { requestId });
  }
};

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");
await send("Fetch.enable", {
  patterns: [
    { urlPattern: "http://localhost:3000/api/meta*", requestStage: "Request" },
    { urlPattern: "http://localhost:3000/api/search*", requestStage: "Request" },
  ],
});

/* the real live rate the page will use once released (cached
   Frankfurter value) -> the exact expected priceMin conversion */
const realMeta = await (await fetch("http://localhost:3000/api/meta")).json();
const liveRate = realMeta.fx.rate;
const expectedMin = String(usdToEur(50, liveRate));

/* T1/T2: fail the meta endpoint, open a USD budget URL. The URL
   effect must wait for the rate, so no search fires and the
   wait-fx branch renders the error + Retry. */
await send("Page.navigate", {
  url: "http://localhost:3000/?q=clothing&min=50&cur=USD",
});
await waitFor(
  () => ev(`[...document.querySelectorAll("button")].some(
    (b) => (b.innerText || "").trim() === "Retry"
  )`),
  15000
);

const failedState = await ev(`(() => {
  const retry = [...document.querySelectorAll("button")].find(
    (b) => (b.innerText || "").trim() === "Retry"
  );
  const input = document.querySelector(
    'input[aria-label="Search for clothes"]'
  );
  return {
    retry: retry ? retry.disabled : "missing",
    section: !!document.querySelector("section"),
    query: input ? input.value : "input missing",
  };
})()`);
check(
  "T1 error block + Retry button, query preserved, no results",
  failedState.retry === false &&
    failedState.query === "clothing" &&
    failedState.section === false,
  JSON.stringify(failedState)
);
check(
  "T2 zero /api/search while the rate is unavailable",
  searchRequests.length === 0,
  `searchRequests=${searchRequests.length}`
);
check(
  "meta was stubbed to 500 across the bounded auto retries",
  metaRequests.length >= 3,
  `metaRequests=${metaRequests.length}`
);

/* T3: release the endpoint, click Retry -> exactly one search
   carrying the converted priceMin. */
stubMode = "pass";
await sleep(300);
await ev(`(() => {
  const b = [...document.querySelectorAll("button")].find(
    (x) => (x.innerText || "").trim() === "Retry"
  );
  if (b) { b.click(); return true; }
  return false;
})()`);
await waitFor(() => searchRequests.length >= 1, 15000);
const searchUrl = new URL(searchRequests[searchRequests.length - 1]);
const priceMin = searchUrl.searchParams.get("priceMin");
check(
  "T3 after Retry one search with the converted priceMin",
  searchRequests.length === 1 && priceMin === expectedMin,
  `searches=${searchRequests.length} priceMin=${priceMin} expected=${expectedMin}`
);

/* T4: results render, the error block is gone, URL unchanged. */
await waitFor(
  () => ev(`document.querySelectorAll("article").length >= 1`),
  15000
);
const after = await ev(`(() => ({
  body: document.body.innerText,
  articles: document.querySelectorAll("article").length,
  url: location.search,
}))()`);
check(
  "T4 error block gone + results rendered",
  !after.body.includes("exchange rate") &&
    !after.body.includes("Retry") &&
    after.articles >= 1,
  JSON.stringify({ articles: after.articles, url: after.url })
);
check(
  "T4 URL still the USD budget URL",
  after.url === "?q=clothing&min=50&cur=USD",
  after.url
);

/* T5: cur=EUR needs no rate -> searches immediately even while
   the meta endpoint keeps failing; no error block appears. */
const eurBefore = searchRequests.length;
stubMode = "fail";
await send("Page.navigate", {
  url: "http://localhost:3000/?q=clothing&min=50&cur=EUR",
});
await waitFor(() => searchRequests.length > eurBefore, 15000);
await waitFor(
  () => ev(`document.querySelectorAll("article").length >= 1`),
  15000
);
const eurAfter = await ev(`(() => ({
  body: document.body.innerText,
  articles: document.querySelectorAll("article").length,
}))()`);
check(
  "T5 EUR budget searches with failing meta, no error block",
  !eurAfter.body.includes("exchange rate") && eurAfter.articles >= 1,
  JSON.stringify({ articles: eurAfter.articles })
);

console.log(
  `F14-C1 meta-failure browser: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);