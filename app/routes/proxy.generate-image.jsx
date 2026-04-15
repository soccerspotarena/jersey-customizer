import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { removeBackground } from "../lib/remove-background.server";

/**
 * POST /proxy/generate-image
 * Reached via Shopify App Proxy: /apps/jersey-customizer/generate-image
 *
 * Body:   { prompt: string, type: "logo" | "sponsor" }
 * Returns: { imageUrl: string }  — data:image/png;base64,… URI  (1024×1024 PNG)
 *         | { error: string }    — always JSON, never HTML
 *
 * Uses DALL-E 3 (dall-e-3 model) to generate photorealistic sports imagery.
 * The customer's prompt is extended with sport-specific style guidance.
 *
 * response_format "b64_json" is used so the PNG is returned inline as base64.
 * This avoids the temporary OpenAI CDN URLs (which expire after 1 hour) and
 * ensures the data URL stored in the Shopify line-item property never goes stale.
 *
 * Note: DALL-E 3 does not support true alpha-channel transparency.  The
 * "transparent background" modifier in the prompt nudges the model toward
 * clean isolated compositions that are easier to composite onto jerseys.
 */

// ── Prompt suffixes (appended to the customer's description) ─────────────────

const PROMPT_SUFFIX = {
  logo:    ", soccer club badge style, transparent background, professional sports logo",
  sponsor: ", professional soccer jersey sponsor logo, clean design, transparent background",
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  try {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405 });
    }

    // ── HMAC verification (production only) ────────────────────────────────
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
      try {
        await authenticate.public.appProxy(request);
      } catch (authErr) {
        const status = authErr instanceof Response ? authErr.status : 401;
        return json({ error: "Unauthorized" }, { status });
      }
    }

    // ── Key check ──────────────────────────────────────────────────────────
    if (!process.env.OPENAI_API_KEY) {
      return json(
        { error: "AI image generation is not configured for this store." },
        { status: 503 }
      );
    }

    // ── Parse body ─────────────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request body." }, { status: 400 });
    }

    const { prompt, type } = body ?? {};
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return json(
        { error: "Please provide a description (at least 3 characters)." },
        { status: 400 }
      );
    }

    // ── Build DALL-E prompt ────────────────────────────────────────────────
    const suffix     = type === "sponsor" ? PROMPT_SUFFIX.sponsor : PROMPT_SUFFIX.logo;
    const fullPrompt = prompt.trim() + suffix;

    // ── Call DALL-E 3 ──────────────────────────────────────────────────────
    let dalleRes;
    try {
      dalleRes = await fetch("https://api.openai.com/v1/images/generations", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model:           "dall-e-3",
          prompt:          fullPrompt,
          n:               1,
          size:            "1024x1024",
          quality:         "standard",
          style:           "vivid",
          response_format: "b64_json",
        }),
      });
    } catch (fetchErr) {
      console.error("[generate-image] Network error calling OpenAI:", fetchErr?.message);
      return json({ error: "Could not reach the image generation service. Please try again." }, { status: 502 });
    }

    // ── Handle OpenAI error responses ──────────────────────────────────────
    if (!dalleRes.ok) {
      let errMsg = `OpenAI API error (${dalleRes.status})`;
      try {
        const errBody = await dalleRes.json();
        errMsg = errBody.error?.message || errMsg;
      } catch { /* response body may not be JSON */ }

      console.error("[generate-image] OpenAI error:", errMsg, "status:", dalleRes.status);
      const outStatus = dalleRes.status === 429 ? 429 : 502;
      return json({ error: errMsg }, { status: outStatus });
    }

    // ── Extract base64 image ───────────────────────────────────────────────
    const dalleData = await dalleRes.json();
    const b64       = dalleData.data?.[0]?.b64_json;

    if (!b64) {
      console.error("[generate-image] Unexpected DALL-E response shape:", JSON.stringify(dalleData).slice(0, 300));
      return json(
        { error: "Could not generate an image. Try a different description." },
        { status: 500 }
      );
    }

    // Strip the background so the image composites cleanly onto the jersey.
    // Falls back to the original DALL-E PNG if REMOVEBG_API_KEY is unset or
    // if the remove.bg call fails for any reason.
    const cleanB64 = await removeBackground(b64);

    return json({ imageUrl: `data:image/png;base64,${cleanB64}` });

  } catch (err) {
    if (err instanceof Response) {
      return json({ error: `Request error (${err.status ?? 500})` }, { status: err.status ?? 500 });
    }
    console.error("[generate-image] Unhandled error:", err?.message ?? err);
    return json({ error: "Server error. Please try again." }, { status: 500 });
  }
};

// Non-POST requests — always JSON
export const loader = async () => {
  return json({ error: "Use POST" }, { status: 405 });
};
