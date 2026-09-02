/* eBay Marketplace Account Deletion / Closure webhook (official approach,
   no User Tokens / Sign-In).

   GET: served during eBay's challenge validation ("challengeCode").
   POST: acknowledges a marketplace account deletion / closure notification.

   The endpoint URL used in the challenge digest is deployment-specific and
   must be the exact public HTTPS URL registered with eBay. It is read from
   EBAY_NOTIFICATION_ENDPOINT_URL; when unset it is derived from the incoming
   request host so it works regardless of where the app is deployed (never
   hard-coded to localhost).
*/

import { NextResponse } from "next/server";

import {
  handleChallengeValidationGet,
  handleNotificationPost,
} from "../../../../lib/ebay-notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const endpointUrl =
    process.env.EBAY_NOTIFICATION_ENDPOINT_URL?.trim() ||
    `${url.origin}${url.pathname}`;

  const result = handleChallengeValidationGet({
    challengeCode: url.searchParams.get("challenge_code"),
    verificationToken:
      process.env.EBAY_NOTIFICATION_VERIFICATION_TOKEN?.trim() || null,
    endpointUrl,
  });

  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(request: Request) {
  const text = await request.text();
  const result = handleNotificationPost(text);
  return NextResponse.json(result.body, { status: result.status });
}
