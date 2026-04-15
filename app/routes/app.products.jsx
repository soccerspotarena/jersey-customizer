/**
 * Product Features admin page — /app/products
 *
 * Lists every product in the store and lets the merchant toggle which
 * customization features (Club Badge, Front Sponsor, Player Name, Jersey
 * Number) are available for each one.
 *
 * Features default to enabled — a ProductSettings row is only written when
 * the merchant saves, so new products work out of the box without any config.
 *
 * Layout
 * ──────
 *  • Bulk-toggle row above the table (one button per feature column)
 *  • IndexTable: product image + title + price in col 1, four Checkbox cols
 *  • Single "Save Changes" primary action — all pending changes committed at once
 *  • Pagination: 50 products per page via Shopify cursor pagination
 */

import { json }                         from "@remix-run/node";
import { useLoaderData, useFetcher,
         useNavigate }                  from "@remix-run/react";
import { useState, useCallback,
         useEffect }                    from "react";
import {
  Page,
  Card,
  IndexTable,
  Checkbox,
  Thumbnail,
  Text,
  InlineStack,
  BlockStack,
  Banner,
  Button,
  Box,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { db }           from "../lib/db.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const FEATURES = [
  { key: "enableLogo",    label: "Club Badge"    },
  { key: "enableSponsor", label: "Front Sponsor" },
  { key: "enableName",    label: "Player Name"   },
  { key: "enableNumber",  label: "Jersey Number" },
];

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop }           = session;

  const url    = new URL(request.url);
  const after  = url.searchParams.get("after")  ?? null;
  const before = url.searchParams.get("before") ?? null;

  // ── Fetch products from Shopify ──────────────────────────────────────────
  const query = before
    ? `#graphql
       query Products($last: Int!, $before: String) {
         products(last: $last, before: $before, sortKey: TITLE) {
           pageInfo { hasPreviousPage hasNextPage startCursor endCursor }
           edges { node {
             id title
             featuredImage { url altText }
             priceRangeV2 { minVariantPrice { amount currencyCode } }
           }}
         }
       }`
    : `#graphql
       query Products($first: Int!, $after: String) {
         products(first: $first, after: $after, sortKey: TITLE) {
           pageInfo { hasPreviousPage hasNextPage startCursor endCursor }
           edges { node {
             id title
             featuredImage { url altText }
             priceRangeV2 { minVariantPrice { amount currencyCode } }
           }}
         }
       }`;

  const variables = before
    ? { last: PAGE_SIZE, before }
    : { first: PAGE_SIZE, after };

  const res      = await admin.graphql(query, { variables });
  const gqlData  = await res.json();
  const pageInfo = gqlData?.data?.products?.pageInfo ?? {};
  const edges    = gqlData?.data?.products?.edges    ?? [];

  const products = edges.map(({ node }) => ({
    // Numeric ID — matches what Liquid's {{ product.id }} returns
    id:       node.id.replace("gid://shopify/Product/", ""),
    gid:      node.id,
    title:    node.title,
    imageUrl: node.featuredImage?.url ?? "",
    imageAlt: node.featuredImage?.altText ?? node.title,
    price:    node.priceRangeV2?.minVariantPrice
      ? formatPrice(
          node.priceRangeV2.minVariantPrice.amount,
          node.priceRangeV2.minVariantPrice.currencyCode
        )
      : "—",
  }));

  // ── Fetch saved settings from DB ─────────────────────────────────────────
  const productIds = products.map((p) => p.id);
  const savedRows  = await db.productSettings.findMany({
    where:  { shop, productId: { in: productIds } },
    select: {
      productId:     true,
      enableLogo:    true,
      enableSponsor: true,
      enableName:    true,
      enableNumber:  true,
    },
  });

  const settingsMap = Object.fromEntries(
    savedRows.map((r) => [r.productId, r])
  );

  return json({ products, settingsMap, pageInfo });
};

function formatPrice(amount, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style:    "currency",
      currency: currency,
      minimumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

// ── Action — save settings ─────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop }    = session;

  const formData = await request.formData();
  let rows;
  try {
    rows = JSON.parse(formData.get("settings") ?? "[]");
  } catch {
    return json({ error: "Invalid settings payload." }, { status: 400 });
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return json({ error: "No settings to save." }, { status: 400 });
  }

  try {
    await Promise.all(
      rows.map((r) =>
        db.productSettings.upsert({
          where:  { shop_productId: { shop, productId: String(r.productId) } },
          update: {
            enableLogo:    Boolean(r.enableLogo),
            enableSponsor: Boolean(r.enableSponsor),
            enableName:    Boolean(r.enableName),
            enableNumber:  Boolean(r.enableNumber),
          },
          create: {
            shop,
            productId:     String(r.productId),
            enableLogo:    Boolean(r.enableLogo),
            enableSponsor: Boolean(r.enableSponsor),
            enableName:    Boolean(r.enableName),
            enableNumber:  Boolean(r.enableNumber),
          },
        })
      )
    );
    return json({ ok: true, count: rows.length });
  } catch (err) {
    console.error("[app/products] save error:", err?.message);
    return json({ error: "Failed to save settings. Please try again." }, { status: 500 });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultSettings() {
  return { enableLogo: true, enableSponsor: true, enableName: true, enableNumber: true };
}

function buildInitialSettings(products, settingsMap) {
  const out = {};
  products.forEach((p) => {
    out[p.id] = settingsMap[p.id]
      ? {
          enableLogo:    settingsMap[p.id].enableLogo,
          enableSponsor: settingsMap[p.id].enableSponsor,
          enableName:    settingsMap[p.id].enableName,
          enableNumber:  settingsMap[p.id].enableNumber,
        }
      : defaultSettings();
  });
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductFeaturesPage() {
  const { products, settingsMap, pageInfo } = useLoaderData();
  const fetcher   = useFetcher();
  const navigate  = useNavigate();

  const isSaving   = fetcher.state !== "idle";
  const saveResult = fetcher.data;

  // Local settings state — initialized from loader, reset when loader data changes
  const [localSettings, setLocalSettings] = useState(() =>
    buildInitialSettings(products, settingsMap)
  );
  const [isDirty, setIsDirty] = useState(false);

  // Re-sync when navigating to a different page
  useEffect(() => {
    setLocalSettings(buildInitialSettings(products, settingsMap));
    setIsDirty(false);
  }, [products, settingsMap]);

  // ── Per-cell toggle ──────────────────────────────────────────────────────
  const handleCell = useCallback((productId, featureKey, value) => {
    setLocalSettings((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], [featureKey]: value },
    }));
    setIsDirty(true);
  }, []);

  // ── Column bulk toggle ───────────────────────────────────────────────────
  const handleColumnToggle = useCallback((featureKey) => {
    const allOn = products.every((p) => localSettings[p.id]?.[featureKey] !== false);
    const next  = !allOn;
    setLocalSettings((prev) => {
      const updated = { ...prev };
      products.forEach((p) => {
        updated[p.id] = { ...updated[p.id], [featureKey]: next };
      });
      return updated;
    });
    setIsDirty(true);
  }, [products, localSettings]);

  // Column state: true = all on, false = all off, "indeterminate" = mixed
  const columnState = (featureKey) => {
    const values = products.map((p) => localSettings[p.id]?.[featureKey] !== false);
    if (values.every(Boolean))   return true;
    if (values.every((v) => !v)) return false;
    return "indeterminate";
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const payload = products.map((p) => ({
      productId: p.id,
      ...(localSettings[p.id] ?? defaultSettings()),
    }));
    fetcher.submit(
      { settings: JSON.stringify(payload) },
      { method: "post" }
    );
    setIsDirty(false);
  }, [products, localSettings, fetcher]);

  // ── Pagination ───────────────────────────────────────────────────────────
  const goNext = () =>
    navigate(`/app/products?after=${encodeURIComponent(pageInfo.endCursor)}`);
  const goPrev = () =>
    navigate(`/app/products?before=${encodeURIComponent(pageInfo.startCursor)}`);

  // ── Table headings — plain strings only (no JSX) ─────────────────────────
  const headings = [
    { title: "Product" },
    { title: "Price", alignment: "end" },
    { title: "Club Badge",    id: "enableLogo",    alignment: "center" },
    { title: "Front Sponsor", id: "enableSponsor", alignment: "center" },
    { title: "Player Name",   id: "enableName",    alignment: "center" },
    { title: "Jersey Number", id: "enableNumber",  alignment: "center" },
  ];

  // ── Rows ─────────────────────────────────────────────────────────────────
  const rowMarkup = products.map((product, index) => {
    const s = localSettings[product.id] ?? defaultSettings();
    const hasAnyDisabled = FEATURES.some(({ key }) => !s[key]);

    return (
      <IndexTable.Row id={product.id} key={product.id} position={index}>

        {/* Product image + title */}
        <IndexTable.Cell>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            {product.imageUrl ? (
              <Thumbnail
                source={product.imageUrl}
                alt={product.imageAlt}
                size="small"
              />
            ) : (
              <Box
                width="40px"
                minHeight="40px"
                background="bg-surface-secondary-active"
                borderRadius="200"
              />
            )}
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                {product.title}
              </Text>
              {hasAnyDisabled && (
                <Badge tone="warning">Partial features</Badge>
              )}
            </BlockStack>
          </InlineStack>
        </IndexTable.Cell>

        {/* Price */}
        <IndexTable.Cell>
          <Text alignment="end" as="span" tone="subdued">{product.price}</Text>
        </IndexTable.Cell>

        {/* Feature checkboxes */}
        {FEATURES.map(({ key, label }) => (
          <IndexTable.Cell key={key}>
            <InlineStack align="center" blockAlign="center">
              <Checkbox
                label={label}
                labelHidden
                checked={s[key]}
                onChange={(val) => handleCell(product.id, key, val)}
              />
            </InlineStack>
          </IndexTable.Cell>
        ))}

      </IndexTable.Row>
    );
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Page
      title="Product Features"
      subtitle="Choose which customization steps are available for each product."
      primaryAction={{
        content:  "Save Changes",
        onAction: handleSave,
        loading:  isSaving,
        disabled: !isDirty || isSaving,
      }}
    >
      <BlockStack gap="400">

        {/* Save feedback */}
        {!isSaving && saveResult && (
          saveResult.ok ? (
            <Banner
              title={`Settings saved for ${saveResult.count} product${saveResult.count !== 1 ? "s" : ""}`}
              tone="success"
              onDismiss={() => {}}
            />
          ) : (
            <Banner title="Save failed" tone="critical">
              <Text>{saveResult.error}</Text>
            </Banner>
          )
        )}

        {/* Legend */}
        <Banner tone="info" title="How feature flags work">
          <Text>
            Unchecking a feature hides that wizard step for customers on that product.
            Use the "Toggle all" buttons below to enable or disable a feature for every
            product on this page at once. Changes take effect within 60 seconds of saving.
          </Text>
        </Banner>

        {/* Bulk-toggle controls */}
        {products.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text variant="headingSm" as="h2">Toggle all products on this page</Text>
              <InlineStack gap="300" wrap>
                {FEATURES.map(({ key, label }) => {
                  const state = columnState(key);
                  return (
                    <Button
                      key={key}
                      onClick={() => handleColumnToggle(key)}
                      tone={state === false ? "critical" : undefined}
                      variant="secondary"
                      size="slim"
                    >
                      {state === true
                        ? `Disable all: ${label}`
                        : `Enable all: ${label}`}
                    </Button>
                  );
                })}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card padding="0">
          {products.length === 0 ? (
            <Box padding="600">
              <Text tone="subdued" alignment="center">No products found in your store.</Text>
            </Box>
          ) : (
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={products.length}
              headings={headings}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>

        {/* Pagination */}
        {(pageInfo.hasPreviousPage || pageInfo.hasNextPage) && (
          <InlineStack align="center" gap="300">
            <Button
              disabled={!pageInfo.hasPreviousPage}
              onClick={goPrev}
            >
              ← Previous
            </Button>
            <Button
              disabled={!pageInfo.hasNextPage}
              onClick={goNext}
            >
              Next →
            </Button>
          </InlineStack>
        )}

      </BlockStack>
    </Page>
  );
}
