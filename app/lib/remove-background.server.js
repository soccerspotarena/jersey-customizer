/**
 * Background removal via the remove.bg API.
 *
 * Takes a raw base64 PNG string (no data-URL prefix), submits it as
 * multipart/form-data, and returns a base64 PNG with the background
 * stripped (transparent alpha channel).
 *
 * Graceful degradation: if REMOVEBG_API_KEY is absent, or if the API
 * returns an error / the network is unreachable, the original base64 is
 * returned unchanged so image generation never fails because of this step.
 *
 * remove.bg API reference: https://www.remove.bg/api
 *   Endpoint : POST https://api.remove.bg/v1.0/removebg
 *   Auth     : X-Api-Key header
 *   Input    : multipart form field "image_file" (PNG binary)
 *   Output   : binary PNG with transparency (response body)
 *   Errors   : JSON  { errors: [{ title, detail }] }
 *
 * Credit cost: 1 API credit per image.  Free tier includes 50 calls/month.
 */

export async function removeBackground(b64) {
  // No-op if the key is absent — caller gets the original DALL-E image.
  if (!process.env.REMOVEBG_API_KEY) {
    return b64;
  }

  try {
    // Decode base64 → binary → Blob so FormData sends the correct MIME type.
    const buffer = Buffer.from(b64, "base64");
    const blob   = new Blob([buffer], { type: "image/png" });

    const form = new FormData();
    form.append("image_file", blob, "image.png");
    form.append("size",       "auto");  // let remove.bg pick the output resolution
    form.append("type",       "auto");  // auto-detect subject (logo, product, etc.)

    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method:  "POST",
      headers: { "X-Api-Key": process.env.REMOVEBG_API_KEY },
      body:    form,
    });

    if (!res.ok) {
      // remove.bg returns JSON error bodies even on non-200 status codes.
      let detail = `remove.bg API error (HTTP ${res.status})`;
      try {
        const errData = await res.json();
        detail = errData.errors?.[0]?.title || detail;
      } catch { /* response may not be JSON on network-level errors */ }
      console.error("[remove-background]", detail);
      return b64; // fall back to original
    }

    // Successful response body is the raw PNG binary (not JSON).
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");

  } catch (err) {
    console.error("[remove-background] Network error:", err?.message);
    return b64; // fall back to original
  }
}
