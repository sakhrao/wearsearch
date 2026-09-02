/* eBay Marketplace Account Deletion / Closure notification webhook
   tests (deterministic, pure - no network, no DB, no Next server).

   Covers: challenge digest (SHA-256 challengeCode + verificationToken +
   endpointUrl), GET challenge validation response, invalid/missing
   challenge, missing-config paths, POST acknowledgement (valid, unknown
   and malformed payloads), and guaranteed NO verification-token leakage.

   Run: npx tsx scripts/ebay-notifications.test.mts
*/

import { createHash } from "node:crypto";

import {
  computeChallengeDigest,
  handleChallengeValidationGet,
  handleNotificationPost,
  type ChallengeValidationResult,
} from "../src/lib/ebay-notifications";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

const TOKEN = "vritkr-plush-dock-9d8f2c1a7b6e5d4f3c2b1a09f8e7d6c5";
const ENDPOINT = "https://wearsearch.example.com/api/ebay/notifications";
const CHALLENGE = "f3c0d47e9a1b6d2e8a4c9f0b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e";

/* Independent SHA-256 reference (Node crypto) to cross-check the digest. */
function referenceDigest(code: string, token: string, url: string): string {
  return createHash("sha256")
    .update(code)
    .update(token)
    .update(url)
    .digest("hex");
}

function challengeHashTest() {
  const digest = computeChallengeDigest({
    challengeCode: CHALLENGE,
    verificationToken: TOKEN,
    endpointUrl: ENDPOINT,
  });
  const expected = referenceDigest(CHALLENGE, TOKEN, ENDPOINT);
  check(
    "challenge digest is a 64-char hex sha256",
    /^[0-9a-f]{64}$/.test(digest),
    digest
  );
  check(
    "challenge digest matches the independent reference",
    digest === expected,
    digest
  );
  check(
    "challenge digest does NOT embed the verification token",
    digest.includes(TOKEN) === false,
    digest
  );

  /* Ordering matters: swapping token/endpoint changes the result. */
  const swapped = computeChallengeDigest({
    challengeCode: CHALLENGE,
    verificationToken: ENDPOINT,
    endpointUrl: TOKEN,
  });
  check("challenge digest is order-sensitive", swapped !== digest, "identical");
}

function getResponseTest() {
  const result = handleChallengeValidationGet({
    challengeCode: CHALLENGE,
    verificationToken: TOKEN,
    endpointUrl: ENDPOINT,
  });
  check("GET returns status 200", result.ok === true && result.status === 200, String(result.status));
  if (result.ok) {
    const expected = referenceDigest(CHALLENGE, TOKEN, ENDPOINT);
    check(
      "GET challengeResponse equals the reference digest",
      result.body.challengeResponse === expected,
      result.body.challengeResponse
    );
    const serialized = JSON.stringify(result);
    check(
      "GET serialized response never contains the verification token",
      serialized.includes(TOKEN) === false,
      "token leaked"
    );
  }
}

function invalidChallengeTest() {
  const missing = handleChallengeValidationGet({
    challengeCode: null,
    verificationToken: TOKEN,
    endpointUrl: ENDPOINT,
  });
  check(
    "missing challenge -> 400 with challengeResponse absent",
    missing.ok === false && missing.status === 400,
    JSON.stringify(missing)
  );

  const empty = handleChallengeValidationGet({
    challengeCode: "",
    verificationToken: TOKEN,
    endpointUrl: ENDPOINT,
  });
  check(
    "empty challenge -> 400",
    empty.ok === false && empty.status === 400,
    String(empty.status)
  );
}

function missingConfigTest() {
  const noToken: ChallengeValidationResult = handleChallengeValidationGet({
    challengeCode: CHALLENGE,
    verificationToken: null,
    endpointUrl: ENDPOINT,
  });
  check(
    "missing verification token -> 500, names env var only",
    noToken.ok === false &&
      noToken.status === 500 &&
      noToken.body.error.includes("EBAY_NOTIFICATION_VERIFICATION_TOKEN"),
    JSON.stringify(noToken)
  );
  check(
    "missing-token error never includes a real value",
    noToken.ok === false && JSON.stringify(noToken.body).includes(TOKEN) === false,
    JSON.stringify(noToken)
  );

  const noUrl = handleChallengeValidationGet({
    challengeCode: CHALLENGE,
    verificationToken: TOKEN,
    endpointUrl: null,
  });
  check(
    "missing endpoint url -> 500, names env var only",
    noUrl.ok === false &&
      noUrl.status === 500 &&
      noUrl.body.error.includes("EBAY_NOTIFICATION_ENDPOINT_URL"),
    JSON.stringify(noUrl)
  );
}

function postAckTest() {
  const valid = handleNotificationPost(
    JSON.stringify({ metadata: { topic: "MARKETPLACE.ACCOUNT.DELETION" } })
  );
  check(
    "valid notification -> 202 acknowledged",
    valid.ok === true && valid.status === 202 && valid.body.received === true,
    JSON.stringify(valid)
  );

  const unknown = handleNotificationPost(
    JSON.stringify({ anything: true, nested: { deep: [1, 2, 3] } })
  );
  check(
    "unknown payload shape still acknowledged (202)",
    unknown.ok === true && unknown.status === 202,
    JSON.stringify(unknown)
  );

  const malformed = handleNotificationPost("this is {not json");
  check(
    "malformed body does not break endpoint (202)",
    malformed.ok === true && malformed.status === 202,
    JSON.stringify(malformed)
  );

  const empty = handleNotificationPost("");
  check(
    "empty body does not break endpoint (202)",
    empty.ok === true && empty.status === 202,
    JSON.stringify(empty)
  );
}

function postNoLeakTest() {
  /* A notification body might contain tokens/PII. The handler discards it,
     so serializing the result must never echo the body content. */
  const secretSnippet = '"clientSecret":"super-secret-9z"';
  const result = handleNotificationPost(
    JSON.stringify({ meta: { cert: "abc" }, body: secretSnippet })
  );
  const serialized = JSON.stringify(result);
  check(
    "POST result never echoes the notification body/secret",
    serialized.includes("super-secret-9z") === false &&
      serialized.includes("clientSecret") === false,
    serialized
  );
}

function main() {
  challengeHashTest();
  getResponseTest();
  invalidChallengeTest();
  missingConfigTest();
  postAckTest();
  postNoLeakTest();

  console.log(`\n===== ebay-notifications tests: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) process.exit(1);
}

main();
