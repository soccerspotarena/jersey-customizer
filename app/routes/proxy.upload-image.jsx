/**
 * POST /proxy/upload-image
 * Reached via Shopify App Proxy: /apps/jersey-customizer/upload-image
 *
 * Receives a base64 PNG image from the jersey-customizer widget, persists it
 * to the PendingImage table, and returns a short opaque token
 * ("pending-image:<cuid>") that the widget stores as the Shopify line-item
 * property value instead of the raw base64.
 *
 * Why:  Shopify silently truncates line-item property values that exceed its
 *       internal size limit.  A 360-px badge PNG is 40–135 KB as base64 —
 *       far above that limit.  The token is ≤ 28 characters and never gets
 *       truncated.  The orders/create webhook resolves the token back to the
 *       full base64 before generating print files.
 *
 * Request body:  { data: "data:image/png;base64,…", type: "logo"|"sponsor" }
 * Success body:  { token: "pending-image:<cuid>" }
 * Error body:    { error: string }
 */

import { json }       from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db }          from "../lib/db.server";

const MAX_DATA_BYTES = 5 * 1024 * 1024; // 5 MB safety limit

export const action = async ({ request }) => {
  console.log("[proxy/upload-image] received", request.method, request.url);
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── HMAC verification (production only) ─────────────────────────────────────
  // The Shopify App Proxy appends a signed HMAC query string; skip in dev
  // to allow tunnel-less local testing.
  let shop = "";
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    try {
      const proxyCtx = await authenticate.public.appProxy(request);
      shop = proxyCtx?.session?.shop ?? "";
    } catch {
      return json({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    // In development, read the shop from the Shopify-appended query param.
    shop = new URL(request.url).searchParams.get("shop") ?? "dev";
  }

  // ── Parse and validate body ──────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { data, type } = body ?? {};

  if (typeof data !== "string" || !data.startsWith("data:image/")) {
    return json({ error: "data must be a base64 image data URL." }, { status: 400 });
  }

  if (data.length > MAX_DATA_BYTES) {
    return json({ error: "Image too large (max 5 MB)." }, { status: 413 });
  }

  const imageType = type === "sponsor" ? "sponsor" : "logo";

  // ── Persist to DB ────────────────────────────────────────────────────────────
  const record = await db.pendingImage.create({
    data: { shop, type: imageType, data },
    select: { id: true },
  });

  return json({ token: `pending-image:${record.id}` });
};

// Non-POST requests (e.g. Shopify proxy GET health-checks)
export const loader = async () =>
  json({ error: "Use POST" }, { status: 405 });
