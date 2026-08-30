/* F17-C4 empty-query-enter — deterministic browser regression for
   the approved C4 fix in src/app/page.tsx.

   Clearing the search field and pressing Enter used to hit the
   handleSearch guard (`!trimmedQuery`) and do nothing: the input
   stayed blank while the old URL and its results remained. The fix
   makes Enter for a blank query route to the empty landing state
   through the URL effect (`router.push("/")` -> "empty" branch ->
   resetResults), consistent with the Search button for a blank
   query -- with no URL/API contract change.

   R1  Enter on a fresh blank page: no-op (stays at /, no results,
       no error, nothing stale).
   R2  after a search (Enter), clearing the input + Enter resets the
       URL to / and drops the old results and the query text.
   R3  same reset after a search launched by the Search button.

   Run: npx tsx scripts/browser/f17-c4-empty-query-enter.mjs <ws-url>
   against next dev + the CDP page target (fresh tab per run). */
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
const inputVal = () => ev(`(document.querySelector('input[aria-label="Search for clothes"]') || {}).value`);
const count = () => ev(`document.querySelectorAll("article").length`);
const running = () => ev(`document.body.innerText.includes("Searching...")`);
const errorText = () => ev(`(() => {
  const el = [...document.querySelectorAll("p, div")].find(
    (x) => (x.textContent || "").includes("Search failed")
  );
  return el ? el.textContent.trim() : null;
})()`);
const settled = async () => (await count()) >= 1 && !(await running());
const inputSel = `document.querySelector('input[aria-label="Search for clothes"]')`;
const raf = () => ev(`new Promise((r) => requestAnimationFrame(() => r(true)))`);
const focusInput = () => ev(`(() => { const i = ${inputSel}; if (!i) return false; i.focus(); i.setSelectionRange(0, i.value.length); return true; })()`);
const typeText = async (text) => {
  for (const ch of text) {
    const code = /[A-Za-z]/.test(ch) ? `Key${ch.toUpperCase()}` : ch === " " ? "Space" : `Digit${ch}`;
    const vk = ch.toUpperCase().charCodeAt(0);
    await send("Input.dispatchKeyEvent", {
      type: "keyDown", key: ch, code, text: ch, unmodifiedText: ch,
      windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp", key: ch, code,
      windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
};
const pressEnter = async () => {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
};
const clearInput = async () => {
  await focusInput();
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "a", code: "KeyA", text: "a",
    windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "a", code: "KeyA",
    windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Backspace", code: "Backspace",
    windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Backspace", code: "Backspace",
    windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
  });
};
const clickSearch = () => ev(`(() => {
  const b = document.querySelector('button[aria-label="Run search"]');
  if (b) b.click();
  return true;
})()`);

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
};

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await send("Page.enable");
await send("Runtime.enable");

/* ============= R1: Enter on a fresh blank page is a no-op ============= */
await send("Page.navigate", { url: "http://localhost:3000/" });
await waitFor(async () => (await inputVal()) === "");
const r1Href = await href();
const r1Count = await count();
await pressEnter();
await sleep(1200);
check("R1 Enter on blank page keeps the URL at /",
  (await href()) === r1Href && (await href()).endsWith("/"),
  `href=${await href()}`);
check("R1 no results, no error on blank Enter",
  (await count()) === 0 && (await errorText()) === null &&
    !(await running()),
  `articles=${await count()} error=${await errorText()} running=${await running()}`);

/* ============ R2: search via Enter, then clear + Enter resets ============ */
await focusInput();
await typeText("jeans");
await raf();
await pressEnter();
await waitFor(settled);
const r2OldHref = await href();
check("R2 search via Enter landed on the query URL",
  r2OldHref.endsWith("/?q=jeans"),
  `href=${r2OldHref}`);
const r2OldCount = await count();
const r2OldTitle = await ev(`(document.querySelector("article img") || {}).alt || null`);

await clearInput();
await pressEnter();
await waitFor(async () =>
  (await href()).endsWith("/") && (await count()) === 0 &&
    !(await running()));
await sleep(800);
const r2Href = await href();
const r2Val = await inputVal();
const r2StaleTitle =
  r2OldTitle === null
    ? false
    : await ev(`[...document.querySelectorAll("article img")]
      .some((i) => i.alt === ${JSON.stringify(r2OldTitle)})`);
check("R2 clear + Enter resets the URL to /",
  r2Href.endsWith("/") && !r2Href.includes("q="),
  `href=${r2Href}`);
check("R2 clear + Enter drops the old results",
  (await count()) === 0 && !r2StaleTitle,
  `articles=${await count()} staleTitle=${r2StaleTitle}`);
check("R2 input is left blank after the reset",
  r2Val === "",
  `input="${r2Val}"`);

/* ============ R3: same reset after a Search-button search ============ */
await focusInput();
await typeText("jeans");
await clickSearch();
await waitFor(settled);
const r3OldCount = await count();
await clearInput();
await raf();
await pressEnter();
await waitFor(async () =>
  (await href()).endsWith("/") && (await count()) === 0 &&
    !(await running()));
await sleep(800);
check("R3 button search then clear + Enter also resets to /",
  (await href()).endsWith("/") &&
    (await count()) === 0 &&
    (await inputVal()) === "",
  `href=${await href()} articles=${await count()} input="${await inputVal()}"`);
check("R3 pre-reset results existed (guard not vacuous)",
  r3OldCount > 0 && r2OldCount > 0,
  `r2=${r2OldCount} r3=${r3OldCount}`);

console.log(
  `F17-C4 empty-query-enter: ${passed} passed, ${failed} failed`
);
ws.close();
process.exit(failed > 0 ? 1 : 0);