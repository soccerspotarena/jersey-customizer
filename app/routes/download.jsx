/**
 * File download endpoint — /download?job=<id>&file=<key>
 *
 * Intentionally outside the `app.` route prefix so it is NOT wrapped by the
 * Shopify embedded-app auth layout.  Opening a download in a new browser tab
 * has no Shopify session cookie, so any route under /app/ would redirect to
 * the OAuth login screen.
 *
 * Security: job IDs are cuids (globally unique, not enumerable).  No session
 * is required — the hard-to-guess ID is sufficient for this internal tool.
 *
 * Query params:
 *   job  — PrintJob.id (cuid)
 *   file — "nameSvg" | "numberSvg" | "logoPng" | "sponsorPng"
 *
 * Downloads are named:  {orderNumber}_{suffix}.{ext}
 *   e.g.  1001_name.svg  |  1001_number.svg  |  1001_badge.png  |  1001_sponsor.png
 */

import { db } from "../lib/db.server";

const FILE_MAP = {
  nameSvg:             { field: "nameSvg",             ext: "svg", suffix: "name",     mime: "image/svg+xml", binary: false },
  numberSvg:           { field: "numberSvg",           ext: "svg", suffix: "number",   mime: "image/svg+xml", binary: false },
  logoPng:             { field: "logoPng",             ext: "png", suffix: "badge",    mime: "image/png",     binary: true  },
  sponsorPng:          { field: "sponsorPng",          ext: "png", suffix: "sponsor",  mime: "image/png",     binary: true  },
  placementPreviewPng: { field: "placementPreviewPng", ext: "png", suffix: "placement",mime: "image/png",     binary: true  },
};

export const loader = async ({ request }) => {
  const url     = new URL(request.url);
  const jobId   = url.searchParams.get("job")  ?? "";
  const fileKey = url.searchParams.get("file") ?? "";

  const fileInfo = FILE_MAP[fileKey];
  if (!fileInfo) {
    return new Response("Invalid file key", { status: 400 });
  }

  const job = await db.printJob.findUnique({
    where:  { id: jobId },
    select: {
      orderName: true,
      [fileInfo.field]: true,
    },
  });

  if (!job) {
    return new Response("Print job not found", { status: 404 });
  }

  const fileData = job[fileInfo.field];
  if (!fileData) {
    return new Response("File not available for this order", { status: 404 });
  }

  // Build filename:  1001_name.svg  (strip # and non-alphanumeric from order name)
  const orderNum = job.orderName.replace(/[^a-zA-Z0-9]/g, "");
  const filename = `${orderNum}_${fileInfo.suffix}.${fileInfo.ext}`;

  // SVG: serve as UTF-8 text.
  // PNG: base64-decode to binary before streaming so the browser gets a real PNG.
  const body    = fileInfo.binary ? Buffer.from(fileData, "base64") : fileData;
  const charset = fileInfo.binary ? "" : "; charset=utf-8";

  return new Response(body, {
    status:  200,
    headers: {
      "Content-Type":        `${fileInfo.mime}${charset}`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "private, no-store",
    },
  });
};

