/**
 * File download endpoint — /app/download?job=<id>&file=<key>
 *
 * Query params:
 *   job  — PrintJob.id (cuid)
 *   file — "nameSvg" | "numberSvg" | "logoPng" | "sponsorPng"
 *
 * Downloads are named:  {orderNumber}_{suffix}.{ext}
 *   e.g.  1001_name.svg  |  1001_number.svg  |  1001_badge.png  |  1001_sponsor.png
 *
 * SVG files are returned as UTF-8 text; PNG files are base64-decoded to binary.
 */

import { authenticate } from "../shopify.server";
import { db }           from "../lib/db.server";

const FILE_MAP = {
  nameSvg:    { field: "nameSvg",    ext: "svg", suffix: "name",    mime: "image/svg+xml", binary: false },
  numberSvg:  { field: "numberSvg",  ext: "svg", suffix: "number",  mime: "image/svg+xml", binary: false },
  logoPng:    { field: "logoPng",    ext: "png", suffix: "badge",   mime: "image/png",     binary: true  },
  sponsorPng: { field: "sponsorPng", ext: "png", suffix: "sponsor", mime: "image/png",     binary: true  },
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { shop }    = session;

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
      shop:      true,
      orderName: true,
      [fileInfo.field]: true,
    },
  });

  if (!job) {
    return new Response("Print job not found", { status: 404 });
  }

  if (job.shop !== shop) {
    return new Response("Forbidden", { status: 403 });
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

export default function DownloadRoute() {
  return null;
}
