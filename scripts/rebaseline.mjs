const BASE_URL =
  process.env.BASE_URL ?? "http://localhost:3000";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL(
  "./search-regression.mjs",
  import.meta.url
);
const src = readFileSync(FILE, "utf8");

async function search(q) {
  const r = await fetch(
    `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(30000) }
  );
  return await r.json();
}

/* collect every pinned query */
const qs = [
  ...src.matchAll(/q:\s*"((?:[^"\\]|\\.)*)",/g),
].map((m) => JSON.parse(`"${m[1]}"`));

const responses = new Map();
for (const q of qs) {
  responses.set(q, await search(q));
}

/* line-wise rewrite: within each case object
   (started by a q: line), refresh exact, similar,
   and status sub-fields from the live response */
const lines = src.split("\n");
let currentQ = null;
let inStatus = false;
let updated = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const qMatch = line.match(
    /^\s*q:\s*"((?:[^"\\]|\\.)*)",/
  );
  if (qMatch) {
    currentQ = JSON.parse(
      `"${qMatch[1]}"`
    );
    inStatus = false;
    continue;
  }

  if (
    /^\s*q:\s*"zz " \.repeat\(50\),/.test(
      line
    ) ||
    /^\s*q:\s*"zz "\.repeat\(50\),/.test(
      line
    )
  ) {
    currentQ = "zz ".repeat(50);
    inStatus = false;
    continue;
  }

  if (!currentQ) continue;

  const data = responses.get(currentQ);
  if (!data) continue;

  if (/^\s*status:\s*\{/.test(line)) {
    inStatus = true;
    continue;
  }
  if (inStatus && /^\s*\},?$/.test(line)) {
    inStatus = false;
    continue;
  }

  let m2;
  if ((m2 = line.match(/^(\s*)exact:\s*(\d+),(.*$)/))) {
    lines[i] =
      `${m2[1]}exact: ${data.exactCount},${m2[3] ?? ""}`;
    continue;
  }

  if (
    (m2 = line.match(
      /^(\s*)similar:\s*(\d+),(.*$)/
    ))
  ) {
    const rest = m2[3] ?? "";
    lines[i] =
      `${m2[1]}similar: ${data.similarCount},${rest}`;
    continue;
  }

  if (inStatus && data.categoryStatus) {
    if (
      (m2 = line.match(
        /^(\s*)requested:\s*".*",(.*)$/
      ))
    ) {
      lines[i] =
        `${m2[1]}requested: "${data.categoryStatus.requested}",${m2[2] ?? ""}`;
      continue;
    }
    if (
      (m2 = line.match(
        /^(\s*)productCount:\s*(\d+),(.*$)/
      ))
    ) {
      lines[i] =
        `${m2[1]}productCount: ${data.categoryStatus.productCount},${m2[3] ?? ""}`;
      continue;
    }
    if (
      (m2 = line.match(
        /^(\s*)siblings:\s*\[.*\],(.*$)/
      ))
    ) {
      const sib =
        data.categoryStatus.siblings
          .map((s) => JSON.stringify(s))
          .join(", ");
      lines[i] =
        `${m2[1]}siblings: [${sib}],${m2[2] ?? ""}`;
      continue;
    }
  }
}

writeFileSync(FILE, lines.join("\n"));
console.log(`rebuilt ${qs.length} pinned queries`);
