/**
 * POST /api/generate-image
 *
 * CORS-enabled fallback endpoint (not used by the current theme extension,
 * which calls the App Proxy route instead).  Kept for direct testing / curl.
 *
 * Uses DALL-E 3 — mirrors proxy.generate-image.jsx exactly, minus App Proxy auth.
 */

import { removeBackground } from "../lib/remove-background.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PROMPT_SUFFIX = {
  logo:    ", soccer club badge style, transparent background, professional sports logo",
  sponsor: ", professional soccer jersey sponsor logo, clean design, transparent background",
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return new Response(
    JSON.stringify({ error: "Use POST" }),
    { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
};

export const action = async ({ request }) => {
  const respond = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== "POST")    return respond({ error: "Method not allowed" }, 405);

    if (!process.env.OPENAI_API_KEY) {
      return respond({ error: "AI image generation is not configured for this store." }, 503);
    }

    let body;
    try { body = await request.json(); }
    catch { return respond({ error: "Invalid request body." }, 400); }

    const { prompt, type } = body ?? {};
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return respond({ error: "Please provide a description (at least 3 characters)." }, 400);
    }

    const suffix     = type === "sponsor" ? PROMPT_SUFFIX.sponsor : PROMPT_SUFFIX.logo;
    const fullPrompt = prompt.trim() + suffix;

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
      console.error("[generate-image] Network error:", fetchErr?.message);
      return respond({ error: "Could not reach the image generation service." }, 502);
    }

    if (!dalleRes.ok) {
      let errMsg = `OpenAI API error (${dalleRes.status})`;
      try { const e = await dalleRes.json(); errMsg = e.error?.message || errMsg; } catch { /* ignore */ }
      console.error("[generate-image] OpenAI error:", errMsg);
      return respond({ error: errMsg }, dalleRes.status === 429 ? 429 : 502);
    }

    const dalleData = await dalleRes.json();
    const b64       = dalleData.data?.[0]?.b64_json;
    if (!b64) {
      return respond({ error: "Could not generate an image. Try a different description." }, 500);
    }

    const cleanB64 = await removeBackground(b64);
    return respond({ imageUrl: `data:image/png;base64,${cleanB64}` });

  } catch (err) {
    console.error("[generate-image] Unhandled error:", err?.message ?? err);
    return respond({ error: "Server error. Please try again." }, 500);
  }
};
