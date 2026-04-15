-- PostgreSQL baseline migration.
-- Replaces all previous SQLite migrations (which used PRAGMA statements
-- incompatible with PostgreSQL).  This single file represents the complete
-- current schema and is safe to run on a fresh Postgres database.

-- CreateTable
CREATE TABLE "Session" (
    "id"            TEXT        NOT NULL,
    "shop"          TEXT        NOT NULL,
    "state"         TEXT        NOT NULL,
    "isOnline"      BOOLEAN     NOT NULL DEFAULT false,
    "scope"         TEXT,
    "expires"       TIMESTAMP(3),
    "accessToken"   TEXT        NOT NULL,
    "userId"        BIGINT,
    "firstName"     TEXT,
    "lastName"      TEXT,
    "email"         TEXT,
    "accountOwner"  BOOLEAN     NOT NULL DEFAULT false,
    "locale"        TEXT,
    "collaborator"  BOOLEAN     DEFAULT false,
    "emailVerified" BOOLEAN     DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingImage" (
    "id"        TEXT        NOT NULL,
    "shop"      TEXT        NOT NULL,
    "type"      TEXT        NOT NULL,
    "data"      TEXT        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingImage_shop_idx" ON "PendingImage"("shop");

-- CreateTable
CREATE TABLE "ProductSettings" (
    "id"            TEXT        NOT NULL,
    "shop"          TEXT        NOT NULL,
    "productId"     TEXT        NOT NULL,
    "enableLogo"    BOOLEAN     NOT NULL DEFAULT true,
    "enableSponsor" BOOLEAN     NOT NULL DEFAULT true,
    "enableName"    BOOLEAN     NOT NULL DEFAULT true,
    "enableNumber"  BOOLEAN     NOT NULL DEFAULT true,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSettings_shop_idx" ON "ProductSettings"("shop");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ProductSettings_shop_productId_key" ON "ProductSettings"("shop", "productId");

-- CreateTable
CREATE TABLE "PrintJob" (
    "id"            TEXT        NOT NULL,
    "shop"          TEXT        NOT NULL,
    "orderId"       TEXT        NOT NULL,
    "orderGid"      TEXT        NOT NULL,
    "orderName"     TEXT        NOT NULL,
    "customerName"  TEXT        NOT NULL,
    "lineItemId"    TEXT        NOT NULL,
    "lineItemTitle" TEXT        NOT NULL,
    "playerName"    TEXT        NOT NULL,
    "jerseyNumber"  TEXT        NOT NULL,
    "nameSvg"       TEXT        NOT NULL,
    "numberSvg"     TEXT        NOT NULL,
    "logoPng"       TEXT,
    "sponsorPng"    TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrintJob_shop_idx" ON "PrintJob"("shop");

-- CreateIndex
CREATE INDEX "PrintJob_shop_orderId_idx" ON "PrintJob"("shop", "orderId");
