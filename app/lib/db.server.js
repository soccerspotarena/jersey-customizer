/**
 * Prisma client singleton for server-side use only.
 *
 * The `.server.js` suffix tells Remix/Vite to exclude this module from
 * the client bundle entirely, preventing PrismaClient from being evaluated
 * in the browser (which would corrupt React's module state and cause the
 * "Cannot read properties of null (reading 'useState')" error in any
 * route that both imports Prisma and exports a React component).
 *
 * In development, the singleton is attached to `globalThis` so that Vite's
 * hot-module replacement doesn't open a new database connection on every
 * file save.
 */

import { PrismaClient } from "@prisma/client";

function createClient() {
  return new PrismaClient();
}

// In production: create once per process.
// In development: reuse the instance across HMR reloads via globalThis.
let db;

if (process.env.NODE_ENV === "production") {
  db = createClient();
} else {
  if (!globalThis.__prisma) {
    globalThis.__prisma = createClient();
  }
  db = globalThis.__prisma;
}

export { db };
