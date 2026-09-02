/* eBay Marketplace Account Deletion / Closure notification webhook
   handlers - list of pure, deterministic functions used by the
   /api/ebay/notifications route.

   Security: the verification token is NEVER logged, echoed, or returned
   from an API here. It is only concatenated into the SHA-256 challenge
   digest. Notification payloads are also not logged, so no access tokens
   or PII embedded in them can leak into logs.

   The endpoint URL used for challenge validation is deployment-specific
   (a public HTTPS URL registered with eBay), so it is passed in explicitly
   rather than assumed to be localhost.
*/

import { createHash } from "node:crypto";

export type ChallengeDigestInput = {
  challengeCode: string;
  verificationToken: string;
  endpointUrl: string;
};

/* eBay challenge validation computes SHA-256 of the concatenation
   challengeCode + verificationToken + endpointUrl. Returns the hex digest. */
export function computeChallengeDigest(input: ChallengeDigestInput): string {
  return createHash("sha256")
    .update(input.challengeCode)
    .update(input.verificationToken)
    .update(input.endpointUrl)
    .digest("hex");
}

export type ChallengeValidationResult =
  | { ok: true; status: 200; body: { challengeResponse: string } }
  | { ok: false; status: number; body: { error: string } };

export type ChallengeValidationInput = {
  /* Raw query value for the `challenge_code` parameter (null if absent). */
  challengeCode: string | null;
  /* Verification token; absent when the server is not configured. */
  verificationToken: string | null;
  /* Public HTTPS endpoint URL that was registered with eBay. */
  endpointUrl: string | null;
};

export function handleChallengeValidationGet(
  input: ChallengeValidationInput
): ChallengeValidationResult {
  if (!input.challengeCode || input.challengeCode.length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: "Missing challenge_code" },
    };
  }

  if (!input.verificationToken) {
    return {
      ok: false,
      status: 500,
      body: {
        error: "EBAY_NOTIFICATION_VERIFICATION_TOKEN is not configured",
      },
    };
  }

  if (!input.endpointUrl) {
    return {
      ok: false,
      status: 500,
      body: { error: "EBAY_NOTIFICATION_ENDPOINT_URL is not configured" },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      challengeResponse: computeChallengeDigest({
        challengeCode: input.challengeCode,
        verificationToken: input.verificationToken,
        endpointUrl: input.endpointUrl,
      }),
    },
  };
}

export type NotificationPostResult = {
  ok: true;
  status: 200 | 202;
  body: { received: true };
};

/* Acknowledge an incoming notification quickly. The payload is parsed
   leniently so an unknown or malformed body never breaks the endpoint;
   the contents are intentionally discarded (never logged or persisted
   here). The 202 tells eBay the event was accepted without implying any
   side effect. */
export function handleNotificationPost(text: string): NotificationPostResult {
  try {
    JSON.parse(text);
  } catch {
    /* Malformed JSON: still acknowledge to avoid tripping the webhook
       retry policy. No content is logged. */
  }
  return { ok: true, status: 202, body: { received: true } };
}
