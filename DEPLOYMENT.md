# Deployment Guide

This project has **two independent deploy targets** that must be handled separately.
Every change requires at least one of them; some changes require both.

---

## Step 1 — Railway (server-side changes)

Deploys the Remix app, webhook handlers, API routes, database migrations,
and anything under `app/`, `prisma/`, `railway.toml`, or `package.json`.

```bash
git add .
git commit -m "your message here"
git push
```

Railway detects the push, runs the build command, and restarts the container:

```
Build:  npx prisma generate && npm run build
Start:  npx prisma migrate deploy && npm run start
```

**Triggers a Railway deploy when you change:**
- `app/` — routes, lib utilities, server logic
- `prisma/schema.prisma` or `prisma/migrations/` — database schema
- `railway.toml` — build/start commands
- `package.json` / `package-lock.json` — dependencies
- `vite.config.js` — build configuration
- `shopify.app.toml` — app URLs, redirect URLs, scopes

---

## Step 2 — Shopify CDN (theme extension changes)

Deploys the storefront theme extension — JavaScript, CSS, and Liquid templates —
to Shopify's CDN so the widget updates on the live storefront.

```bash
npx shopify app deploy
```

**Triggers a Shopify deploy when you change anything under `extensions/`:**
- `extensions/jersey-customizer/assets/jersey-customizer.js`
- `extensions/jersey-customizer/assets/jersey-customizer.css`
- `extensions/jersey-customizer/blocks/jersey-customizer.liquid`
- `extensions/jersey-customizer/shopify.extension.toml`

> Git push alone does **not** update the storefront widget.
> `shopify app deploy` alone does **not** update the server.

---

## Which steps are needed?

| What changed | Railway (git push) | Shopify (app deploy) |
|---|:---:|:---:|
| Server routes, lib, webhooks | yes | no |
| Prisma schema / migrations | yes | no |
| `shopify.app.toml` URLs | yes | yes |
| `extensions/` JS / CSS / Liquid | no | yes |
| Both server and extension files | yes | yes |

---

## Full deploy (both targets)

```bash
git add .
git commit -m "your message here"
git push
npx shopify app deploy
```
