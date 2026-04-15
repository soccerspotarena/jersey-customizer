/**
 * test-print-files.js
 *
 * Simulates an ORDERS_CREATE webhook with fake jersey customization data and
 * runs the full print-file generation pipeline locally — no Shopify checkout,
 * no webhook HMAC, no tunnel required.
 *
 * Usage:
 *   node scripts/test-print-files.js
 *
 * Output:
 *   • Saves a PrintJob row to the local dev.sqlite database
 *   • Writes all generated files to  test-output/<orderName>/
 *   • Prints a summary so you can spot-check dimensions / content
 *
 * View the result in the app admin:
 *   /app/print-files  (the job appears at the top of the list)
 */

import { createRequire }   from "module";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname }   from "path";
import { fileURLToPath }   from "url";
import sharp               from "sharp";
import { PrismaClient }    from "@prisma/client";
import {
  extractJerseyData,
  generateNameSVG,
  generateNumberSVG,
  generateLogoPNG,
  generateSponsorPNG,
} from "../app/lib/print-files.server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db        = new PrismaClient();

// ── Config ────────────────────────────────────────────────────────────────────
// Edit these values to test different combinations.

const TEST = {
  shop:        "test-shop.myshopify.com",
  orderName:   "#TEST-001",
  orderId:     "99900000001",
  customerName: "Alex Johnson",
  lineItemId:  "88800000001",
  lineItemTitle: "Custom Jersey",

  playerName:   "HENDERSON",
  jerseyNumber: "14",
  font:         "Jersey M54",   // any key from FONT_MAP in print-files.server.js
  textColor:    "White",        // "White" → #ffffff  |  "Black" → #000000

  // Set to true to include badge / sponsor images in the test
  includeLogo:   true,
  includeSponsor: true,
  sponsorSize:   "35%",
};

// ── Build fake PNG images ─────────────────────────────────────────────────────
// Creates solid-colour test images via sharp so the PNG generators have
// real pixel data to work with (no external file dependency).

async function makeFakePng(width, height, r, g, b) {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r, g, b, alpha: 255 },
    },
  })
    .png()
    .toBuffer();
  return "data:image/png;base64," + buf.toString("base64");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log("\n=== Jersey Customizer — Print File Test ===\n");
  console.log(`Player : ${TEST.playerName}`);
  console.log(`Number : ${TEST.jerseyNumber}`);
  console.log(`Font   : ${TEST.font}`);
  console.log(`Color  : ${TEST.textColor}`);
  console.log(`Logo   : ${TEST.includeLogo   ? "yes" : "no"}`);
  console.log(`Sponsor: ${TEST.includeSponsor ? "yes (size " + TEST.sponsorSize + ")" : "no"}`);
  console.log("");

  // Build a fake logo PNG: 400×400 royal-blue square
  const logoPngDataUrl = TEST.includeLogo
    ? await makeFakePng(400, 400, 0, 71, 171)   // royal blue
    : null;

  // Build a fake sponsor PNG: 400×200 red rectangle
  const sponsorPngDataUrl = TEST.includeSponsor
    ? await makeFakePng(400, 200, 200, 0, 0)     // red
    : null;

  // Build a line item that mimics a real Shopify order payload
  const fakeLineItem = {
    id:    TEST.lineItemId,
    title: TEST.lineItemTitle,
    properties: [
      { name: "Player Name",   value: TEST.playerName   },
      { name: "Jersey Number", value: TEST.jerseyNumber },
      { name: "Font",          value: TEST.font         },
      { name: "Text Color",    value: TEST.textColor    },
      ...(TEST.includeLogo    ? [{ name: "Logo Image",    value: logoPngDataUrl    }] : []),
      ...(TEST.includeSponsor ? [{ name: "Sponsor Image", value: sponsorPngDataUrl }] : []),
      ...(TEST.includeSponsor ? [{ name: "Sponsor Size",  value: TEST.sponsorSize  }] : []),
    ],
  };

  // ── Run through the same logic as webhooks.orders.create.jsx ──────────────

  const jerseyData = extractJerseyData(fakeLineItem);
  if (!jerseyData) {
    console.error("extractJerseyData returned null — no Player Name property found.");
    process.exit(1);
  }

  console.log("Generating Name SVG …");
  const nameSvg = generateNameSVG(jerseyData.playerName, jerseyData.font, jerseyData.textColor);

  console.log("Generating Number SVG …");
  const numberSvg = generateNumberSVG(jerseyData.jerseyNumber, jerseyData.font, jerseyData.textColor);

  console.log("Generating Logo PNG …");
  const logoPng = jerseyData.logoImage
    ? await generateLogoPNG(jerseyData.logoImage)
    : null;

  console.log("Generating Sponsor PNG …");
  const sponsorPng = jerseyData.sponsorImage
    ? await generateSponsorPNG(jerseyData.sponsorImage, jerseyData.sponsorSize)
    : null;

  // ── Save to database ──────────────────────────────────────────────────────

  console.log("\nSaving PrintJob to database …");
  const job = await db.printJob.create({
    data: {
      shop:          TEST.shop,
      orderId:       TEST.orderId,
      orderGid:      `gid://shopify/Order/${TEST.orderId}`,
      orderName:     TEST.orderName,
      customerName:  TEST.customerName,
      lineItemId:    TEST.lineItemId,
      lineItemTitle: TEST.lineItemTitle,
      playerName:    jerseyData.playerName,
      jerseyNumber:  jerseyData.jerseyNumber,
      nameSvg,
      numberSvg,
      logoPng,
      sponsorPng,
    },
  });

  console.log(`PrintJob created  id: ${job.id}`);

  // ── Write files to disk for visual inspection ─────────────────────────────

  const outDir = join(__dirname, "../test-output", TEST.orderName.replace(/[^a-zA-Z0-9]/g, "_"));
  mkdirSync(outDir, { recursive: true });

  const files = [];

  writeFileSync(join(outDir, "name.svg"), nameSvg, "utf8");
  files.push({ file: "name.svg",    desc: "Name HTV  — 11\" × 3\"" });

  writeFileSync(join(outDir, "number.svg"), numberSvg, "utf8");
  files.push({ file: "number.svg",  desc: "Number HTV — 6\" × 9\"" });

  if (logoPng) {
    writeFileSync(join(outDir, "badge.png"), Buffer.from(logoPng, "base64"));
    // Probe actual dimensions
    const meta = await sharp(Buffer.from(logoPng, "base64")).metadata();
    files.push({ file: "badge.png",   desc: `Badge DTF  — ${meta.width}×${meta.height} px (expect 750×900)` });
  }

  if (sponsorPng) {
    writeFileSync(join(outDir, "sponsor.png"), Buffer.from(sponsorPng, "base64"));
    const meta = await sharp(Buffer.from(sponsorPng, "base64")).metadata();
    const expectedPx = Math.round((parseFloat(TEST.sponsorSize) / 100) * 10 * 300);
    files.push({ file: "sponsor.png", desc: `Sponsor DTF — ${meta.width}×${meta.height} px (expect ${expectedPx}×${expectedPx})` });
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n=== Generated files ===");
  for (const f of files) {
    console.log(`  ✓  ${f.file.padEnd(14)} ${f.desc}`);
  }

  console.log(`\nOutput directory: ${outDir}`);
  console.log(`\nView in admin:    /app/print-files`);
  console.log(`(Search for order "${TEST.orderName}" or just check the top of the list)\n`);

  await db.$disconnect();
}

run().catch((err) => {
  console.error("\n[ERROR]", err);
  process.exit(1);
});
