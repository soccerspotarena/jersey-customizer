# Jersey Customizer — Project Status

Last updated: 2026-05-22

---

## What this app does

A Shopify embedded app that adds a jersey customization widget to the storefront.
Customers can set a player name, jersey number, font, club badge (logo), and front
sponsor. On checkout, the app auto-generates print-ready files for the merchant:
SVG cut files for name/number (HTV/Cricut) and PNG print files for logo/sponsor (DTF/Epson).

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend framework | Remix 2 (React + Node, file-based routing) |
| Shopify integration | `@shopify/shopify-app-remix` v3 |
| Admin UI | Shopify Polaris |
| Database | PostgreSQL via Prisma (hosted on Railway) |
| Image processing | `sharp` (Node), `opentype.js` (font rendering) |
| AI image generation | OpenAI `gpt-image-1` via REST API |
| Background removal | remove.bg API (optional, graceful fallback) |
| Backend hosting | Railway (auto-deploys on `git push` to `main`) |
| Storefront widget | Shopify Theme Extension (JS + CSS + Liquid) |
| Frontend hosting | Shopify CDN (deployed via `shopify app deploy`) |

---

## Architecture

```
Customer browser
  └── Theme Extension widget (extensions/jersey-customizer/)
        ├── Shopify CDN serves JS/CSS/Liquid
        └── App Proxy (/apps/jersey-customizer/*)
              └── Railway server (Remix routes under app/routes/proxy.*)

Merchant browser
  └── Shopify Admin (embedded iframe)
        └── Railway server (Remix routes under app/routes/app.*)

Shopify
  └── orders/create webhook → Railway → generates + stores print files
```

**App Proxy URL:** `https://jersey-customizer-production.up.railway.app/proxy`
maps from `https://<store>.myshopify.com/apps/jersey-customizer/*`

---

## Database models (PostgreSQL / Prisma)

- **Session** — Shopify OAuth sessions (managed by `shopify-app-remix`)
- **PendingImage** — temporarily holds uploaded base64 PNGs during checkout;
  the widget stores a short token (`pending-image:<id>`) as the line-item property
  instead of raw base64 (which Shopify silently truncates above ~28 chars)
- **ProductSettings** — per-product feature flags (enableLogo, enableSponsor,
  enableName, enableNumber); all default true, only a row exists when changed
- **PrintJob** — one row per customized line item; stores name/number SVGs,
  logo/sponsor PNGs, and a placement preview PNG; viewed on the Print Files admin page

---

## Admin pages

| URL | Purpose |
|---|---|
| `/app/products` | Toggle which features are enabled per product |
| `/app/print-files` | View and download print files for each order |
| `/app/settings` | App settings (currently font preview) |
| `/app/download` | File download handler |

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (set by Railway) |
| `SHOPIFY_API_KEY` | Yes | From Shopify Partners dashboard |
| `SHOPIFY_API_SECRET` | Yes | From Shopify Partners dashboard |
| `OPENAI_API_KEY` | Yes | OpenAI key with `gpt-image-1` access |
| `REMOVEBG_API_KEY` | No | remove.bg key; app falls back to unstripped PNG if absent |
| `HOST` | Yes | Full app URL, e.g. `https://jersey-customizer-production.up.railway.app` |

---

## Production environment

- **Store:** `the-soccer-spot-arena.myshopify.com`
- **App URL:** `https://jersey-customizer-production.up.railway.app`
- **Git remote:** `https://github.com/soccerspotarena/jersey-customizer.git`
- **Branch:** `main`

---

## Recently resolved: AI image generation (2026-05-22)

**Symptom:** `[generate-image] OpenAI error: Unknown parameter: 'style'. status: 400`

**Root cause:** OpenAI removed `dall-e-3` from the API on May 12 2026. Requests
to that model were routed to `gpt-image-1`, which does not support the `style`
parameter (or `quality: "standard"` or `response_format`).

**Fix (commit `38c6b7b`):** Migrated both image-generation routes to `gpt-image-1`
with correct parameters:

```js
// Before (broken)
{ model: "dall-e-3", quality: "standard", style: "vivid", response_format: "b64_json" }

// After (current)
{ model: "gpt-image-1", quality: "medium", background: "transparent" }
```

`background: "transparent"` gives native alpha-channel output, reducing reliance on
the remove.bg post-processing step.

**Files changed:** `app/routes/proxy.generate-image.jsx`, `app/routes/api.generate-image.jsx`

A `console.log` of the full request body is now printed before every OpenAI call
so Railway logs confirm exactly what is sent.

---

## Deploy process

This project has **two independent deploy targets.** See `DEPLOYMENT.md` for the
full decision table.

### Step 1 — Railway (server-side changes)

Triggered automatically by a push to `main`. Covers anything under `app/`,
`prisma/`, `railway.toml`, `package.json`, `vite.config.js`, `shopify.app.toml`.

```bash
git add .
git commit -m "your message"
git push
```

Railway runs: `npx prisma generate && npm run build` on build,
then `npx prisma migrate deploy && npm run start` on container start.

### Step 2 — Shopify CDN (extension changes)

Required whenever anything under `extensions/` changes. Git push alone does NOT
update the storefront widget.

```bash
npx shopify app deploy
```

### Which step do I need?

| What changed | `git push` | `shopify app deploy` |
|---|:---:|:---:|
| Routes / lib / webhooks (`app/`) | yes | no |
| Prisma schema / migrations | yes | no |
| `shopify.app.toml` URLs or scopes | yes | yes |
| Extension JS / CSS / Liquid (`extensions/`) | no | yes |

---

## Key file map

```
app/
  routes/
    proxy.generate-image.jsx   ← AI image generation (App Proxy, used by storefront)
    api.generate-image.jsx     ← same logic, CORS-enabled (for curl testing)
    proxy.upload-image.jsx     ← image upload handler
    proxy.product-settings.jsx ← feature flags read by the widget
    webhooks.orders.create.jsx ← generates print files on order
    app.products.jsx           ← admin: per-product feature toggles
    app.print-files.jsx        ← admin: print file viewer/downloader
  lib/
    remove-background.server.js  ← remove.bg wrapper (graceful fallback)
    print-files.server.js        ← SVG/PNG print file generation logic
    fonts.server.js              ← font loading for server-side rendering
    db.server.js                 ← Prisma client singleton

extensions/jersey-customizer/
  assets/jersey-customizer.js   ← all storefront widget logic (vanilla JS)
  assets/jersey-customizer.css  ← widget styles
  blocks/jersey-customizer.liquid ← Liquid block that mounts the widget

prisma/
  schema.prisma                  ← DB schema (Session, PendingImage, ProductSettings, PrintJob)
```
