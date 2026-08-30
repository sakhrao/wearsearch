/* F11 RC-1 regression: a stale Load-more response must never
   mutate a newer search (append / hasMore / offsets).

   Requires the dev server on :3000 and a CDP chrome on :9222.
   Usage: node scripts/browser/f11-race-guard.mjs <page-ws-url>

   Deterministic: the CDP Fetch domain HELDS the offset=30 request
   of intent A, lets a new search B resolve, then releases A. No
   timing races - the interleave is forced. Fails pre-fix (mixed
   60-card grid), passes post-fix (new search stays intact). */
import { strict as assert } from "node:assert";

const ws = new WebSocket(process.argv[2]);
let id = 0;
const pending = new Map();
let heldRequestId = null;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
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
async function waitFor(fn, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(150);
  }
  throw new Error("waitFor timeout");
}
async function cards() {
  return ev(`document.querySelectorAll("article").length`);
}
async function stableCards(target, tries = 10) {
  let stable = 0;
  while (stable < tries) {
    const n = await cards();
    if (n === target) stable += 1;
    else stable = 0;
    await sleep(120);
  }
  return target;
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg);
    return;
  }
  if (msg.method === "Fetch.requestPaused") {
    const { requestId, request } = msg.params;
    if (request.url.includes("offset=30")) {
      if (heldRequestId !== null) {
        void send("Fetch.continueRequest", { requestId });
        return;
      }
      heldRequestId = requestId;
      console.log("  [CDP] offset=30 request HELD");
    } else {
      void send("Fetch.continueRequest", { requestId });
    }
  }
};

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");

/* ground truth from the API */
const topsDbg = await (await fetch("http://localhost:3000/api/search?q=tops&debug=1")).json();
const topsP1 = await (await fetch("http://localhost:3000/api/search?q=tops&limit=30&offset=0")).json();
const topsP2 = await (await fetch("http://localhost:3000/api/search?q=tops&limit=30&offset=30")).json();
const clothP2 = await (await fetch("http://localhost:3000/api/search?q=clothing&limit=30&offset=30")).json();
const topsAll = [...topsP1.exactProducts, ...topsP2.exactProducts].map((p) => p.productUrl);
const clothP2Hrefs = clothP2.exactProducts.map((p) => p.productUrl);

/* ---- phase 1: stale Load-more must be dropped on new search ---- */
await send("Page.navigate", { url: "http://localhost:3000/?q=clothing" });
await stableCards(30);
assert.equal(await cards(), 30, "phase1a: clothing page 1");
console.log("  phase 1a: q=clothing -> 30 cards");

await send("Fetch.enable", {
  patterns: [{ urlPattern: "*api/search*offset=30*", requestStage: "Request" }],
});
await ev(`(() => {
  [...document.querySelectorAll("button")].find((el) => (el.innerText || "").includes("Load more exact matches")).click();
  return true;
})()`);
await waitFor(() => heldRequestId !== null);
console.log("  phase 1b: Load more (clothing) request held");

await ev(`(() => {
  const input = document.querySelector('input[aria-label="Search for clothes"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "tops");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await sleep(250);
await ev(`(() => {
  [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "Run search").click();
  return true;
})()`);
await waitFor(() => ev(`document.body.innerText`).then((h) => h.includes("Showing 30 of 411 exact matches")));
console.log("  phase 1c: new q=tops resolved (30 cards)");

await send("Fetch.continueRequest", { requestId: heldRequestId });
heldRequestId = null;
await send("Fetch.disable");
await sleep(1000);
const afterP1 = await cards();
console.log("  phase 1d: after stale release, cards =", afterP1);
assert.equal(afterP1, 30, "phase1d: stale Load-more did NOT append to the new search");
const body1 = await ev(`document.body.innerText`);
assert.ok((body1.match(/Showing 30 of 411 exact matches/) || []).length > 0,
  "phase1d: header still 'Showing 30 of 411'");
const hrefs1 = await ev(`[...document.querySelectorAll("article a")].map((a) => a.href)`);
assert.deepEqual(hrefs1, topsP1.exactProducts.map((p) => p.productUrl),
  "phase1d: displayed list is exactly tops page 1");

/* ---- phase 2: next Load-more uses the NEW intent's offset ---- */
await ev(`(() => {
  [...document.querySelectorAll("button")].find((el) => (el.innerText || "").includes("Load more exact matches")).click();
  return true;
})()`);
await stableCards(60);
const hrefs2 = await ev(`[...document.querySelectorAll("article a")].map((a) => a.href)`);
assert.equal(hrefs2.length, 60, "phase2: 60 cards after Load more");
assert.deepEqual(hrefs2, topsAll, "phase2: grid = tops pages 1+2 (no skipped window, no foreign items)");
const foreign = hrefs2.filter((h) => clothP2Hrefs.includes(h));
assert.equal(foreign.length, 0, "phase2: zero clothing items leaked");
console.log("  phase 2: Load more on the NEW intent -> tops 1+2 exactly, offsets intact");
console.log("  [pass] f11-race-guard: stale Load-more never mutates a newer search");

ws.close();
process.exit(0);