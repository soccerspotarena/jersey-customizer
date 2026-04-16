-- Add placement preview PNG column to PrintJob.
-- Nullable so existing rows remain valid without backfilling.
ALTER TABLE "PrintJob" ADD COLUMN "placementPreviewPng" TEXT;
