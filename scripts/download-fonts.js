#!/usr/bin/env node
/**
 * scripts/download-fonts.js
 *
 * Downloads the TrueType font files used for SVG path generation.
 * Fonts are saved to app/fonts/ and loaded at runtime by fonts.server.js.
 *
 * Run:  node scripts/download-fonts.js
 *
 * How it works:
 *   1. Fetches the CSS from Google Fonts using an old IE User-Agent so Google
 *      returns TTF download links instead of WOFF2.
 *   2. Parses the first font-file URL from the CSS @font-face block.
 *   3. Downloads and saves the binary to app/fonts/<file>.
 *
 * Safe to re-run — already-downloaded files are skipped.
 */

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, dirname }                        from "path";
import { fileURLToPath }                        from "url";

const __dir   = dirname(fileURLToPath(import.meta.url));
const FONTDIR = join(__dir, "../app/fonts");
mkdirSync(FONTDIR, { recursive: true });

// Firefox 3.6 user-agent causes Google Fonts to serve WOFF1 links.
// WOFF1 is supported by opentype.js; WOFF2 and EOT are not.
const UA_IE = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.6; en-US; rv:1.9.2) Gecko/20100115 Firefox/3.6";

const FONTS = [
  { file: "bebas-neue.ttf",        googleFamily: "Bebas+Neue"             },
  { file: "jersey-m54.ttf",        googleFamily: "Jersey+25"              }, // Jersey M54 is not in Google Fonts; Jersey 25 is the closest match
  { file: "rubik-black.ttf",       googleFamily: "Rubik:wght@900"         },
  { file: "exo2-extrabold.ttf",    googleFamily: "Exo+2:wght@800"        },
  { file: "teko-bold.ttf",         googleFamily: "Teko:wght@700"          },
  { file: "alfa-slab-one.ttf",     googleFamily: "Alfa+Slab+One"          },
  { file: "josefin-sans-bold.ttf", googleFamily: "Josefin+Sans:wght@700" },
  { file: "rajdhani-bold.ttf",     googleFamily: "Rajdhani:wght@700"      },
];

async function downloadFont({ file, googleFamily }) {
  const dest = join(FONTDIR, file);
  if (existsSync(dest)) {
    console.log(`  skip  ${file}  (already downloaded)`);
    return;
  }

  // ── Step 1: get CSS from Google Fonts ───────────────────────────────────────
  const cssUrl = `https://fonts.googleapis.com/css2?family=${googleFamily}&display=swap`;
  const cssRes = await fetch(cssUrl, { headers: { "User-Agent": UA_IE } });
  if (!cssRes.ok) throw new Error(`Google Fonts CSS request failed (${cssRes.status})`);
  const css = await cssRes.text();

  // ── Step 2: parse the font-file URL from the @font-face block ───────────────
  // Google Fonts returns one @font-face per subset; grab the first font URL.
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) {
    throw new Error(
      `Could not find a font URL in the Google Fonts CSS response.\n` +
      `CSS preview: ${css.slice(0, 300)}`
    );
  }
  const fontUrl = match[1];

  // ── Step 3: download the binary ─────────────────────────────────────────────
  const fontRes = await fetch(fontUrl);
  if (!fontRes.ok) throw new Error(`Font download failed (${fontRes.status})`);
  const buf = Buffer.from(await fontRes.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  done  ${file}  (${(buf.length / 1024).toFixed(0)} KB)`);
}

console.log("Downloading fonts to app/fonts/ …\n");
let failures = 0;
for (const font of FONTS) {
  try {
    await downloadFont(font);
  } catch (err) {
    console.error(`  FAIL  ${font.file}: ${err.message}`);
    failures++;
  }
}
console.log(failures === 0 ? "\nAll fonts ready." : `\n${failures} download(s) failed — check your internet connection.`);
process.exit(failures > 0 ? 1 : 0);
