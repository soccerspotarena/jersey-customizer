/**
 * Print-ready file generation for jersey customisations.
 *
 * ┌─────────────┬────────┬──────────────┬────────────────────────────────────┐
 * │ File        │ Format │ Canvas size  │ Use                                │
 * ├─────────────┼────────┼──────────────┼────────────────────────────────────┤
 * │ nameSvg     │ SVG    │ 11" × 3"     │ HTV cut — Cricut Explore 4         │
 * │ numberSvg   │ SVG    │  6" × 9"     │ HTV cut — Cricut Explore 4         │
 * │ logoPng     │ PNG    │ 750×900 px   │ DTF 2.5"×3" @300 DPI — Epson ET    │
 * │ sponsorPng  │ PNG    │ customer %   │ DTF @300 DPI — Epson ET-2800        │
 * └─────────────┴────────┴──────────────┴────────────────────────────────────┘
 *
 * SVG HTV notes
 * ─────────────
 * • Text is converted to outlined <path> elements by opentype.js using
 *   locally-cached TTF files (downloaded by scripts/download-fonts.js).
 *   No @import, no Google Fonts URL, no internet required — works fully
 *   offline in Cricut Design Space.
 * • Fill is solid black or white — no stroke, no gradients.
 * • Four L-shaped crop marks at the corners aid alignment.
 *
 * PNG DTF notes
 * ─────────────
 * • Source images arrive as base64 PNG data-URLs stored in line-item props.
 * • sharp resizes them to the correct 300-DPI pixel dimensions.
 * • Badge: always 2.5"×3" (750×900 px), fit-contain with transparent bg.
 * • Sponsor: sized proportionally to the customer's chosen % of the jersey
 *   chest print area (assumed 10" wide). Source is square → output is square.
 */

import sharp                        from "sharp";
import { getFont, textToSvgPath }   from "./fonts.server.js";
import { db }                       from "./db.server.js";

// ── Image token resolver ───────────────────────────────────────────────────────

/**
 * Resolve a line-item image property value to a base64 data URL.
 *
 * The JS widget uploads images to PendingImage and stores a compact token
 * ("pending-image:<cuid>") as the property value instead of the raw base64,
 * which Shopify would silently truncate.  This function converts the token
 * back to the full base64 so the print-file generators receive valid input.
 *
 * Falls back transparently if the property still contains a raw data URL
 * (legacy orders or failed uploads).
 *
 * @param {string|null|undefined} value  Raw line-item property value
 * @returns {Promise<string|null>}       base64 data URL, or null
 */
export async function resolveImage(value) {
  if (!value) return null;
  if (value.startsWith("pending-image:")) {
    const id = value.slice("pending-image:".length);
    try {
      const row = await db.pendingImage.findUnique({
        where:  { id },
        select: { data: true },
      });
      if (!row) {
        console.warn("[print-files] resolveImage: no PendingImage record for id", id);
      }
      return row?.data ?? null;
    } catch (err) {
      console.error("[print-files] resolveImage DB error for id", id, ":", err?.message);
      return null;
    }
  }
  // Legacy: raw base64 data URL stored directly in the property
  if (value.startsWith("data:")) return value;
  return null;
}

// ── XML escaping (used in aria-label attributes) ───────────────────────────────

function x(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── L-shaped crop marks ───────────────────────────────────────────────────────

function cropMarks(w, h, arm = 18) {
  const c  = "#b0b0b0";
  const sw = 0.6;
  return [
    `<line x1="0"  y1="0"  x2="${arm}" y2="0"          stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="0"  y1="0"  x2="0"      y2="${arm}"      stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="${w}" y1="0"  x2="${w-arm}" y2="0"        stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="${w}" y1="0"  x2="${w}"     y2="${arm}"    stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="0"  y1="${h}" x2="${arm}" y2="${h}"        stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="0"  y1="${h}" x2="0"      y2="${h-arm}"   stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="${w}" y1="${h}" x2="${w-arm}" y2="${h}"     stroke="${c}" stroke-width="${sw}"/>`,
    `<line x1="${w}" y1="${h}" x2="${w}"     y2="${h-arm}" stroke="${c}" stroke-width="${sw}"/>`,
  ].join("\n  ");
}

// ── SVG boilerplate ───────────────────────────────────────────────────────────

function svgOpen(widthIn, heightIn, vbW, vbH, title) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- SoccerSpot Jersey Customizer — print-ready HTV cut file\n` +
    `     Size : ${widthIn}in × ${heightIn}in  |  viewBox: ${vbW}×${vbH}\n` +
    `     Text converted to outlined paths — no fonts required in Cricut Design Space\n` +
    `     Open in Cricut Design Space → Cut mode → Siser EasyWeed Stretch Matte -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg"\n` +
    `     width="${widthIn}in" height="${heightIn}in"\n` +
    `     viewBox="0 0 ${vbW} ${vbH}"\n` +
    `     role="img" aria-label="${x(title)}">`
  );
}

const svgClose = "\n</svg>";

// ── Name SVG — 11" wide × 3" tall ────────────────────────────────────────────
// viewBox 1056 × 288 (96 dpi)

const NAME_W = 1056;
const NAME_H = 288;

// Text fills 950 px wide (90 % of canvas) with 19 px margin each side.
// Height is capped at 250 px to leave a 19 px margin top and bottom.
const NAME_TARGET_W = 950;
const NAME_TARGET_H = 250;

/**
 * @param {string} name      Player name
 * @param {string} fontName  Key from the storefront font picker
 * @param {string} colorHex  "#ffffff" or "#000000"
 * @returns {string}         Complete SVG markup with outlined text paths
 */
export function generateNameSVG(name, fontName, colorHex) {
  const font  = getFont(fontName);
  const color = colorHex || "#ffffff";
  const upper = name.toUpperCase();

  // stretchX=true: always scale horizontally to fill NAME_TARGET_W, just
  // like the old textLength="950" attribute did.
  const pathEl = textToSvgPath(font, upper, NAME_W, NAME_H, NAME_TARGET_W, NAME_TARGET_H, color, true);

  return [
    svgOpen("11", "3", NAME_W, NAME_H, `Jersey name: ${upper}`),
    `  ${cropMarks(NAME_W, NAME_H)}`,
    `  ${pathEl}`,
    svgClose,
  ].join("\n");
}

// ── Number SVG — 6" wide × 9" tall ───────────────────────────────────────────
// viewBox 576 × 864 (96 dpi)

const NUM_W = 576;
const NUM_H = 864;

// Number fills up to 500 px wide and 780 px tall — 38 px margin all around.
const NUM_TARGET_W = 500;
const NUM_TARGET_H = 780;

/**
 * @param {string|number} number   Jersey number
 * @param {string}        fontName Key from the storefront font picker
 * @param {string}        colorHex "#ffffff" or "#000000"
 * @returns {string}               Complete SVG markup with outlined text paths
 */
export function generateNumberSVG(number, fontName, colorHex) {
  const font   = getFont(fontName);
  const color  = colorHex || "#ffffff";
  const numStr = String(number);

  // Freshman's digits sit too close together at their natural advance widths.
  // 0.08 em of extra inter-glyph spacing corrects this; all other fonts use 0.
  const letterSpacingEm = fontName === "Freshman" ? 0.08 : 0;

  // stretchX=false: uniform scale so digit proportions are preserved.
  const pathEl = textToSvgPath(font, numStr, NUM_W, NUM_H, NUM_TARGET_W, NUM_TARGET_H, color, false, letterSpacingEm);

  return [
    svgOpen("6", "9", NUM_W, NUM_H, `Jersey number: ${numStr}`),
    `  ${cropMarks(NUM_W, NUM_H)}`,
    `  ${pathEl}`,
    svgClose,
  ].join("\n");
}

// ── Badge PNG — 2.5" × 3" @ 300 DPI = 750 × 900 px ─────────────────────────

/**
 * Resize the customer's club badge to the exact DTF print dimensions.
 *
 * @param {string} base64DataUrl  data:image/png;base64,… from line-item property
 * @returns {Promise<string|null>} base64 PNG string (no data-URL prefix), or null
 */
export async function generateLogoPNG(base64DataUrl) {
  if (!base64DataUrl) return null;
  try {
    const b64    = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
    const input  = Buffer.from(b64, "base64");
    const output = await sharp(input)
      .resize(750, 900, {
        fit:        "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return output.toString("base64");
  } catch (err) {
    console.error("[print-files] generateLogoPNG failed:", err?.message);
    return null;
  }
}

// ── Sponsor PNG — customer-sized @ 300 DPI ───────────────────────────────────

const JERSEY_CHEST_INCHES = 10;

/**
 * @param {string} base64DataUrl  data:image/png;base64,…
 * @param {string} sizePct        e.g. "35%" — from "Sponsor Size" line-item property
 * @returns {Promise<string|null>} base64 PNG string, or null
 */
export async function generateSponsorPNG(base64DataUrl, sizePct) {
  if (!base64DataUrl) return null;
  try {
    const pct       = parseFloat(sizePct) || 35;
    const widthIn   = (pct / 100) * JERSEY_CHEST_INCHES;
    const px        = Math.max(Math.round(widthIn * 300), 150);
    const b64       = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
    const input     = Buffer.from(b64, "base64");
    const output    = await sharp(input)
      .resize(px, px, {
        fit:        "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return output.toString("base64");
  } catch (err) {
    console.error("[print-files] generateSponsorPNG failed:", err?.message);
    return null;
  }
}

// ── Order data extraction ─────────────────────────────────────────────────────

/**
 * Pull jersey customisation properties from a Shopify line-item object.
 * Returns `null` if this line item has no jersey customisation.
 */
export function extractJerseyData(lineItem) {
  const props = {};
  for (const { name, value } of lineItem.properties ?? []) {
    props[name] = value;
  }

  // Treat the line item as a jersey customisation if ANY customisation
  // property is present — a customer may fill only the front (logo/sponsor)
  // and leave name/number blank, or vice-versa.
  const hasAny = props["Player Name"] || props["Jersey Number"] ||
                 props["Logo Image"]  || props["Sponsor Image"];
  if (!hasAny) return null;

  return {
    playerName:    props["Player Name"]   || "",
    jerseyNumber:  props["Jersey Number"] || "",
    font:          props["Font"]          || "Buinton",
    textColor:     props["Text Color"] === "Black" ? "#000000" : "#ffffff",
    logoImage:     props["Logo Image"]    || "",
    sponsorImage:  props["Sponsor Image"] || "",
    sponsorSize:   props["Sponsor Size"]  || "35%",
  };
}
