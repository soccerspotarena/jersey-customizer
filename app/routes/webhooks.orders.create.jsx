/**
 * Webhook handler: ORDERS_CREATE
 *
 * Triggered by Shopify when a new order is created.
 * For each line item that carries jersey customisation properties:
 *  1. Extract the customisation data (name, number, font, colour, logo, sponsor)
 *  2. Generate print-ready files:
 *       nameSvg    — SVG, 11" × 3",  HTV cut  (Cricut Explore 4)
 *       numberSvg  — SVG,  6" × 9",  HTV cut  (Cricut Explore 4)
 *       logoPng    — PNG, 750×900 px, 300 DPI  (DTF, Epson ET-2800)
 *       sponsorPng — PNG, customer-sized, 300 DPI  (DTF, Epson ET-2800)
 *  3. Persist to the PrintJob database table
 *  4. Append a note to the Shopify order so merchants know files are ready
 */

import { authenticate } from "../shopify.server";
import { db }           from "../lib/db.server";
import {
  extractJerseyData,
  resolveImage,
  generateNameSVG,
  generateNumberSVG,
  generateLogoPNG,
  generateSponsorPNG,
  generatePlacementPreview,
} from "../lib/print-files.server";


export const action = async ({ request }) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);

  if (topic !== "ORDERS_CREATE") {
    return new Response("Unexpected topic", { status: 200 });
  }

  const order      = payload;
  const lineItems  = order.line_items ?? [];
  const orderGid   = order.admin_graphql_api_id;
  const orderName  = order.name ?? `#${order.id}`;

  const customerFirst = order.customer?.first_name ?? "";
  const customerLast  = order.customer?.last_name  ?? "";
  const customerName  = `${customerFirst} ${customerLast}`.trim() || "Guest";

  const jobsCreated = [];

  for (const lineItem of lineItems) {
    const jerseyData = extractJerseyData(lineItem);
    if (!jerseyData) continue;

    // Resolve image tokens → base64 data URLs before generating print files.
    // "pending-image:<id>" tokens are looked up in PendingImage; raw data URLs
    // pass through unchanged (legacy fallback).
    const logoData    = await resolveImage(jerseyData.logoImage);
    const sponsorData = await resolveImage(jerseyData.sponsorImage);

    // SVG files are synchronous; only generate when the field was actually filled.
    const nameSvg   = jerseyData.playerName
      ? generateNameSVG(jerseyData.playerName, jerseyData.font, jerseyData.textColor)
      : "";
    const numberSvg = jerseyData.jerseyNumber
      ? generateNumberSVG(jerseyData.jerseyNumber, jerseyData.font, jerseyData.textColor)
      : "";
    const logoPng    = logoData    ? await generateLogoPNG(logoData)                               : null;
    const sponsorPng = sponsorData ? await generateSponsorPNG(sponsorData, jerseyData.sponsorSize) : null;

    // Fetch the jersey front image URL so we can composite the placement preview.
    // lineItem.product_id is the numeric Shopify product ID from the REST payload.
    let jerseyImageUrl = null;
    if (lineItem.product_id) {
      try {
        const productRes  = await admin.graphql(
          `#graphql
          query GetProductImage($id: ID!) {
            product(id: $id) { featuredImage { url } }
          }`,
          { variables: { id: `gid://shopify/Product/${lineItem.product_id}` } }
        );
        const productData = await productRes.json();
        jerseyImageUrl    = productData?.data?.product?.featuredImage?.url ?? null;
      } catch (err) {
        console.warn("[webhook] Could not fetch product image for placement preview:", err?.message);
      }
    }

    const placementPreviewPng = await generatePlacementPreview({
      jerseyImageUrl,
      logoDataUrl:     logoData,
      logoPosition:    jerseyData.logoPosition,
      logoSizeLabel:   jerseyData.logoSizeLabel,
      sponsorDataUrl:  sponsorData,
      sponsorPosition: jerseyData.sponsorPosition,
      sponsorSizePct:  jerseyData.sponsorSize,
    });

    const job = await db.printJob.create({
      data: {
        shop,
        orderId:             String(order.id),
        orderGid,
        orderName,
        customerName,
        lineItemId:          String(lineItem.id),
        lineItemTitle:       lineItem.title ?? "Jersey",
        playerName:          jerseyData.playerName,
        jerseyNumber:        jerseyData.jerseyNumber,
        nameSvg,
        numberSvg,
        logoPng,
        sponsorPng,
        placementPreviewPng,
      },
    });

    jobsCreated.push(job.id);
  }

  // Append a plain-text note so the merchant sees the status on the order page.
  if (jobsCreated.length > 0) {
    const existingNote = order.note ? `${order.note}\n\n` : "";
    const appendedNote =
      `${existingNote}✓ Jersey Customizer: print files ready for ${jobsCreated.length} item(s). ` +
      `Download SVGs (HTV) and PNGs (DTF) from the Jersey Customizer app → Print Files.`;

    await admin.graphql(
      `#graphql
      mutation orderUpdateNote($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id note }
          userErrors { field message }
        }
      }`,
      { variables: { input: { id: orderGid, note: appendedNote } } }
    );
  }

  return new Response(null, { status: 200 });
};
