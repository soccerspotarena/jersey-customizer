/**
 * app/lib/fonts.server.js
 *
 * Loads TrueType font files from app/fonts/ (populated by
 * scripts/download-fonts.js) via opentype.js and converts text strings
 * into outlined SVG <path> elements — no @import, no network calls.
 *
 * Fonts are parsed once and cached in memory for the process lifetime.
 */

import opentype           from "opentype.js";
import { readFileSync }   from "fs";
import { join, dirname }  from "path";
import { fileURLToPath }  from "url";

const __dir   = dirname(fileURLToPath(import.meta.url));
const FONTDIR = join(__dir, "../fonts");

// ── Font registry ──────────────────────────────────────────────────────────────

// Maps storefront font-picker names → TTF filename in app/fonts/
const FONT_FILES = {
  "Jersey M54": "jersey-m54.ttf",
  Varsity:      "rubik-black.ttf",
  Impact:       "bebas-neue.ttf",         // condensed substitute; Impact is system-only
  Eurostile:    "exo2-extrabold.ttf",
  Predator:     "teko-bold.ttf",
  Nordin:       "alfa-slab-one.ttf",
  Futura:       "josefin-sans-bold.ttf",
  Integral:     "rajdhani-bold.ttf",
  Buinton:      "bebas-neue.ttf",
  Freshman:     "freshman.ttf",
};

const DEFAULT_FILE = "bebas-neue.ttf";

// ── In-process cache ──────────────────────────────────────────────────────────

const cache = new Map(); // filename → opentype.Font

function loadFont(filename) {
  if (cache.has(filename)) return cache.get(filename);

  const filePath = join(FONTDIR, filename);
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    throw new Error(
      `Font file missing: ${filePath}\n` +
      `Run  node scripts/download-fonts.js  to download the required fonts.`
    );
  }

  // Convert Node Buffer to ArrayBuffer for opentype.parse
  const ab   = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const font = opentype.parse(ab);
  cache.set(filename, font);
  return font;
}

/**
 * Returns the opentype.Font for the given storefront font-picker name.
 * Falls back to Bebas Neue (Buinton) for unknown names.
 */
export function getFont(fontName) {
  const file = FONT_FILES[fontName] ?? DEFAULT_FILE;
  return loadFont(file);
}

// ── Text → outlined SVG <path> ─────────────────────────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100; // round to 2 dp for compact output

/**
 * Converts `text` to an outlined SVG <path> element, scaled and centred
 * within a canvas of (canvasW × canvasH).
 *
 * The path is generated at a large reference font size (1000 px) for
 * maximum precision, then scaled via a matrix transform to fit the target
 * area.  No font reference, @import, or network call is produced.
 *
 * @param {import('opentype.js').Font} font
 * @param {string}  text      The string to outline (rendered as-is)
 * @param {number}  canvasW   SVG canvas width  (viewBox units)
 * @param {number}  canvasH   SVG canvas height (viewBox units)
 * @param {number}  targetW   Max text width  within the canvas
 * @param {number}  targetH   Max text height within the canvas
 * @param {string}  fill      Solid fill colour, e.g. "#ffffff"
 * @param {boolean} [stretchX=false]
 *   When true the text is always scaled to exactly targetW wide (like the
 *   SVG textLength attribute), while height uses the uniform fit scale.
 *   Use for jersey names where filling the full label width is expected.
 *   When false a uniform scale is used (neither dimension exceeds its target).
 *   Use for numbers where digit proportions should be preserved.
 * @param {number} [letterSpacingEm=0]
 *   Extra spacing inserted between glyphs, expressed in em units (e.g. 0.08
 *   adds 8 % of the font size between each character).  Converted to pixels
 *   at the internal 1000 px reference size before being passed to opentype.js.
 *   Leave at 0 (the default) for all fonts except those that need it.
 * @returns {string}  A `<path … />` element string, or '' for empty input.
 */
export function textToSvgPath(font, text, canvasW, canvasH, targetW, targetH, fill, stretchX = false, letterSpacingEm = 0) {
  if (!text) return "";

  // Render at a large reference size to maximise curve precision.
  const REF = 1000;

  // Convert em-based letter spacing to pixels at the reference size.
  const lsPx = letterSpacingEm * REF;
  const otOpts = lsPx ? { letterSpacing: lsPx } : undefined;

  // Measure the full string's bounding box for scaling and centering.
  const fullPath = font.getPath(text, 0, 0, REF, otOpts);
  const bb       = fullPath.getBoundingBox();

  // Empty / whitespace-only strings produce a zero-area bounding box.
  if (bb.x1 >= bb.x2 || bb.y1 >= bb.y2) return "";

  const natW = bb.x2 - bb.x1;
  const natH = bb.y2 - bb.y1;

  // Uniform scale: fit within targetW × targetH without distortion.
  const uniformScale = Math.min(targetW / natW, targetH / natH);

  // scaleX: either stretch to fill targetW, or use the same uniform scale.
  const scaleX = stretchX ? targetW / natW : uniformScale;
  // scaleY: always the uniform "contain" scale (never stretch vertically).
  const scaleY = uniformScale;

  const scaledW = natW * scaleX;
  const scaledH = natH * scaleY;

  // Centre the scaled glyph block within the full canvas.
  const tx = (canvasW - scaledW) / 2 - bb.x1 * scaleX;
  const ty = (canvasH - scaledH) / 2 - bb.y1 * scaleY;

  // Get one Path object per glyph (correctly kerned/advanced by opentype.js).
  //
  // Emitting a separate <path> per glyph is critical for Cricut Design Space
  // compatibility.  Cricut splits compound paths (multiple M…Z sub-paths in
  // one <path>) into individual shapes and evaluates fill-rule on each piece
  // in isolation.  That causes counter shapes (A hole, O hole, etc.) to
  // render as filled shapes rather than cutouts — and letters with no counter
  // (L, I, T…) appear to gain a "spurious inner rectangle" when Cricut shows
  // the A/O counter as a free-floating shape adjacent to them.
  //
  // By keeping each glyph in its own <path fill-rule="evenodd">, the outer
  // and inner contours of every character always travel together.  Cricut
  // sees one shape per letter and evenodd correctly punches out the counters.
  const glyphPaths = font.getPaths(text, 0, 0, REF, otOpts);

  const pathEls = glyphPaths
    .map(p => {
      const d = p.toPathData(1);
      if (!d) return "";
      return (
        `<path` +
        ` d="${d}"` +
        ` fill="${fill}"` +
        ` fill-rule="evenodd"` +
        ` stroke="none"` +
        `/>`
      );
    })
    .filter(Boolean)
    .join("\n    ");

  const transform = `matrix(${r2(scaleX)},0,0,${r2(scaleY)},${r2(tx)},${r2(ty)})`;

  return `<g transform="${transform}">\n    ${pathEls}\n  </g>`;
}
