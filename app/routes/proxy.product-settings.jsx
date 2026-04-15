/**
 * GET /proxy/product-settings?productId=<numeric-id>
 * Reached via Shopify App Proxy: /apps/jersey-customizer/product-settings
 *
 * Returns the feature-flag JSON for a single product so the storefront
 * customizer widget knows which wizard steps to show.
 *
 * Falls back to all-enabled defaults when:
 *   • the product has no saved settings (new products work out of the box)
 *   • the request is missing required params
 *   • any DB error occurs
 *
 * The Shopify App Proxy automatically appends a signed `shop` query param,
 * so no separate HMAC verification is needed here — we read shop from the
 * URL.  The data is non-sensitive (just boolean feature flags) so this is
 * acceptable even without full proxy auth.
 */

import { json }        from "@remix-run/node";
import { db }          from "../lib/db.server";

const DEFAULTS = {
  enableLogo:    true,
  enableSponsor: true,
  enableName:    true,
  enableNumber:  true,
};

const RESPONSE_HEADERS = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    // Cache for 60 s on the CDN — short enough that saving new settings
    // takes effect within a minute, long enough to avoid per-page-view DB hits.
    "Cache-Control": "public, max-age=60, s-maxage=60",
    "Content-Type":  "application/json",
  },
};

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  // productId as supplied by Liquid: `{{ product.id }}` — always numeric
  const rawProductId = url.searchParams.get("productId") ?? "";
  // shop is appended automatically by the App Proxy
  const shop         = url.searchParams.get("shop")      ?? "";

  if (!rawProductId || !shop) {
    return json(DEFAULTS, RESPONSE_HEADERS);
  }

  // Strip the GID prefix if a caller ever passes the full GID
  const productId = rawProductId.replace(/^gid:\/\/shopify\/Product\//, "");

  try {
    const row = await db.productSettings.findUnique({
      where:  { shop_productId: { shop, productId } },
      select: {
        enableLogo:    true,
        enableSponsor: true,
        enableName:    true,
        enableNumber:  true,
      },
    });
    return json(row ?? DEFAULTS, RESPONSE_HEADERS);
  } catch {
    // Fail open — never block the storefront due to a DB error
    return json(DEFAULTS, RESPONSE_HEADERS);
  }
};

// Non-GET requests (e.g. Shopify proxy health-checks)
export const action = async () =>
  json({ error: "Use GET" }, { status: 405 });
