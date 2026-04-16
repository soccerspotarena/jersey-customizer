/**
 * Print Files admin page — /app/print-files
 *
 * Lists all generated print-ready files for jersey orders, newest first.
 * Supports ?order=1001 to jump directly to a specific order's row.
 *
 * Also provides a manual-trigger card so merchants can generate print files
 * for any order by pasting an order number (#1001) or a numeric order ID,
 * bypassing the need for the orders/create webhook to have fired.
 *
 * Each row shows:
 *   • Name SVG  + Number SVG  — HTV cut files for Cricut Explore 4
 *   • Badge PNG + Sponsor PNG — DTF full-colour files for Epson ET-2800
 */

import { json }                    from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState }                from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Banner,
  Button,
  DataTable,
  EmptyState,
  TextField,
  Divider,
} from "@shopify/polaris";
import { authenticate }   from "../shopify.server";
import { db }             from "../lib/db.server";
import {
  extractJerseyData,
  resolveImage,
  generateNameSVG,
  generateNumberSVG,
  generateLogoPNG,
  generateSponsorPNG,
  generatePlacementPreview,
} from "../lib/print-files.server";

// ── GraphQL fragment shared by both lookup strategies ─────────────────────────

const ORDER_FIELDS = `
  id
  name
  lineItems(first: 50) {
    edges {
      node {
        id
        title
        product { featuredImage { url } }
        customAttributes { key value }
      }
    }
  }
`;

// ── Action — manual print-file generation ─────────────────────────────────────

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop }           = session;

  const formData = await request.formData();
  const raw      = (formData.get("orderId") ?? "").toString().trim();

  if (!raw) {
    return json({ error: "Please enter an order number (e.g. #1001) or a numeric order ID." });
  }

  // Strip leading # so "#1001" and "1001" both work
  const cleaned = raw.replace(/^#\s*/, "").trim();

  // ── Fetch order from Shopify ──────────────────────────────────────────────
  let orderNode = null;

  // Long all-digit strings (≥ 8 digits) are Shopify order IDs — look up by GID.
  if (/^\d{8,}$/.test(cleaned)) {
    const res  = await admin.graphql(
      `#graphql
      query GetOrderById($id: ID!) {
        order(id: $id) { ${ORDER_FIELDS} }
      }`,
      { variables: { id: `gid://shopify/Order/${cleaned}` } }
    );
    const data = await res.json();
    orderNode  = data?.data?.order ?? null;
  }

  // Fall back to (or exclusively use) order-name search: "name:#1001"
  if (!orderNode) {
    const res  = await admin.graphql(
      `#graphql
      query GetOrderByName($query: String!) {
        orders(first: 1, query: $query) {
          edges { node { ${ORDER_FIELDS} } }
        }
      }`,
      { variables: { query: `name:#${cleaned}` } }
    );
    const data = await res.json();
    orderNode  = data?.data?.orders?.edges?.[0]?.node ?? null;
  }

  if (!orderNode) {
    return json({ error: `No order found for "${raw}". Check the number and try again.` });
  }

  // ── Build line items in the same shape extractJerseyData expects ──────────
  const orderId    = orderNode.id.split("/").pop();
  const orderName  = orderNode.name;
  const customerName = "";

  const lineItems = orderNode.lineItems.edges.map(({ node }) => ({
    id:             node.id.split("/").pop(),
    title:          node.title,
    jerseyImageUrl: node.product?.featuredImage?.url ?? null,
    // GraphQL uses customAttributes {key,value}; extractJerseyData expects {name,value}
    properties:     node.customAttributes.map(({ key, value }) => ({ name: key, value })),
  }));

  // ── Generate print files for each customised line item ────────────────────
  const generated = [];
  const skipped   = [];

  for (const lineItem of lineItems) {
    const jerseyData = extractJerseyData(lineItem);
    if (!jerseyData) {
      skipped.push(lineItem.title);
      continue;
    }

    const nameSvg   = jerseyData.playerName
      ? generateNameSVG(jerseyData.playerName, jerseyData.font, jerseyData.textColor)
      : "";
    const numberSvg = jerseyData.jerseyNumber
      ? generateNumberSVG(jerseyData.jerseyNumber, jerseyData.font, jerseyData.textColor)
      : "";
    // Resolve "pending-image:<cuid>" tokens → base64 before passing to sharp.
    // Without this, sharp receives the token string, decodes it as garbage
    // base64, and silently returns null.
    const logoData    = await resolveImage(jerseyData.logoImage);
    const sponsorData = await resolveImage(jerseyData.sponsorImage);
    const logoPng    = logoData    ? await generateLogoPNG(logoData)                               : null;
    const sponsorPng = sponsorData ? await generateSponsorPNG(sponsorData, jerseyData.sponsorSize) : null;

    const placementPreviewPng = await generatePlacementPreview({
      jerseyImageUrl:  lineItem.jerseyImageUrl ?? null,
      logoDataUrl:     logoData,
      logoPosition:    jerseyData.logoPosition,
      logoSizeLabel:   jerseyData.logoSizeLabel,
      sponsorDataUrl:  sponsorData,
      sponsorPosition: jerseyData.sponsorPosition,
      sponsorSizePct:  jerseyData.sponsorSize,
    });

    await db.printJob.create({
      data: {
        shop,
        orderId,
        orderGid:            orderNode.id,
        orderName,
        customerName,
        lineItemId:          lineItem.id,
        lineItemTitle:       lineItem.title,
        playerName:          jerseyData.playerName,
        jerseyNumber:        jerseyData.jerseyNumber,
        nameSvg,
        numberSvg,
        logoPng,
        sponsorPng,
        placementPreviewPng,
      },
    });

    generated.push(lineItem.title);
  }

  if (generated.length === 0) {
    return json({
      error:
        `Order ${orderName} was found but none of its line items carry jersey ` +
        `customisation properties. Make sure the customer filled in the customizer.`,
    });
  }

  return json({ ok: true, orderName, count: generated.length });
};

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop }    = session;

  const url    = new URL(request.url);
  const filter = url.searchParams.get("order") ?? "";

  const where = filter
    ? { shop, orderName: { contains: filter } }
    : { shop };

  const jobs = await db.printJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take:    200,
    select: {
      id:                   true,
      orderId:              true,
      orderName:            true,
      customerName:         true,
      lineItemTitle:        true,
      playerName:           true,
      jerseyNumber:         true,
      nameSvg:              true,
      numberSvg:            true,
      logoPng:              true,
      sponsorPng:           true,
      placementPreviewPng:  true,
      createdAt:            true,
    },
  });

  return json({ jobs, filter });
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function PrintFilesPage() {
  const { jobs, filter } = useLoaderData();

  return (
    <Page
      title="Print Files"
      subtitle="Download HTV cut files (SVG) and DTF print files (PNG) for each customised jersey order."
    >
      <BlockStack gap="500">

        <Banner title="File guide" tone="info">
          <BlockStack gap="200">
            <Text>Each customised jersey order generates up to four files:</Text>
            <ul style={{ paddingLeft: "1.2rem", margin: 0, lineHeight: "1.8" }}>
              <li>
                <strong>Name SVG</strong> &amp; <strong>Number SVG</strong> — HTV cut files.
                Open in <strong>Cricut Design Space</strong>, set to Cut mode,
                use <em>Siser EasyWeed Stretch Matte</em> vinyl.
              </li>
              <li>
                <strong>Badge PNG</strong> &amp; <strong>Sponsor PNG</strong> — DTF full-colour files.
                Send directly to your <strong>Epson ET-2800</strong> via your DTF RIP software at 300 DPI.
              </li>
              <li>
                <strong>Placement Preview PNG</strong> — composite reference image (600×800 px) showing
                the jersey with the badge and sponsor overlaid at the exact position and size the customer
                chose. Use this to align transfers on the physical jersey before pressing.
              </li>
            </ul>
          </BlockStack>
        </Banner>

        <ManualGenerateCard />

        <Divider />

        {filter && (
          <Banner tone="success" title={`Showing results for order "${filter}"`}>
            <Button url="/app/print-files" size="slim">Clear filter</Button>
          </Banner>
        )}

        {jobs.length === 0 ? (
          <Card>
            <EmptyState
              heading="No print files yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <Text>
                {filter
                  ? `No customised jersey orders found matching "${filter}".`
                  : "Print files are generated automatically when a customised jersey order is placed, or use the form above to generate them manually."}
              </Text>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text"]}
              headings={["Order", "Customer", "Player / #", "Files", "Date"]}
              rows={jobs.map((job) => [
                <Text fontWeight="semibold" key={job.id + "-o"}>{job.orderName}</Text>,
                <Text key={job.id + "-c"}>{job.customerName}</Text>,
                <Text key={job.id + "-p"}>{job.playerName} — #{job.jerseyNumber}</Text>,
                <InlineStack gap="200" wrap key={job.id + "-btns"}>
                  {job.nameSvg              && <FileButton jobId={job.id} fileKey="nameSvg"              label="Name (HTV)"          />}
                  {job.numberSvg            && <FileButton jobId={job.id} fileKey="numberSvg"            label="Number (HTV)"        />}
                  {job.logoPng              && <FileButton jobId={job.id} fileKey="logoPng"              label="Badge (DTF)"         />}
                  {job.sponsorPng           && <FileButton jobId={job.id} fileKey="sponsorPng"           label="Sponsor (DTF)"       />}
                  {job.placementPreviewPng  && <FileButton jobId={job.id} fileKey="placementPreviewPng"  label="Placement Preview"   />}
                </InlineStack>,
                <Text key={job.id + "-d"} tone="subdued">
                  {new Date(job.createdAt).toLocaleDateString()}
                </Text>,
              ])}
            />
          </Card>
        )}

      </BlockStack>
    </Page>
  );
}

// ── Manual generate card ──────────────────────────────────────────────────────

function ManualGenerateCard() {
  const fetcher       = useFetcher();
  const [input, setInput] = useState("");
  const isLoading     = fetcher.state !== "idle";
  const result        = fetcher.data;

  const handleSubmit = (e) => {
    e.preventDefault();
    fetcher.submit({ orderId: input }, { method: "post" });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text variant="headingMd" as="h2">Generate print files manually</Text>
          <Text tone="subdued">
            Enter an order number (e.g. <strong>#1001</strong>) or the numeric Shopify order ID
            to generate print files without needing the webhook to fire.
          </Text>
        </BlockStack>

        <form onSubmit={handleSubmit}>
          <InlineStack gap="300" blockAlign="end">
            <div style={{ flexGrow: 1 }}>
              <TextField
                label="Order number or ID"
                labelHidden
                value={input}
                onChange={setInput}
                placeholder="#1001 or 5123456789012"
                autoComplete="off"
                disabled={isLoading}
              />
            </div>
            <Button
              variant="primary"
              loading={isLoading}
              disabled={!input.trim()}
              submit
            >
              Generate Print Files
            </Button>
          </InlineStack>
        </form>

        {!isLoading && result && (
          result.ok ? (
            <Banner
              tone="success"
              title={`Print files generated for order ${result.orderName}`}
              onDismiss={() => fetcher.data = null}
            >
              <Text>
                {result.count} line item{result.count !== 1 ? "s" : ""} processed.
                The new files appear at the top of the list below.
              </Text>
            </Banner>
          ) : (
            <Banner tone="critical" title="Generation failed">
              <Text>{result.error}</Text>
            </Banner>
          )
        )}
      </BlockStack>
    </Card>
  );
}

// ── File download button ───────────────────────────────────────────────────────

function FileButton({ jobId, fileKey, label }) {
  const href = `/download?job=${encodeURIComponent(jobId)}&file=${encodeURIComponent(fileKey)}`;
  return (
    <Button size="slim" url={href} download target="_blank" accessibilityLabel={`Download ${label}`}>
      {label}
    </Button>
  );
}
