/**
 * GET /proxy/fonts/amoresa-aged
 * Reached via Shopify App Proxy: /apps/jersey-customizer/fonts/amoresa-aged
 *
 * Serves amoresa-aged.otf from app/fonts/ so the storefront live-preview can
 * load it via @font-face without needing the file in the theme extension
 * assets directory (which only allows .jpg/.png/.js/.css/.svg/.json/.wasm).
 *
 * No HMAC auth required — font binaries are not sensitive.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir    = dirname(fileURLToPath(import.meta.url));
const fontPath = join(__dir, "../fonts/amoresa-aged.otf");

export const loader = async () => {
  let buf;
  try {
    buf = readFileSync(fontPath);
  } catch {
    return new Response("Font not found", { status: 404 });
  }

  return new Response(buf, {
    headers: {
      "Content-Type":                "font/otf",
      "Cache-Control":               "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
