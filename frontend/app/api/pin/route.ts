import { NextResponse, type NextRequest } from "next/server";
import { cidBytes, rawCidV1 } from "@/lib/media/cid";
import { singleBlockCar } from "@/lib/server/car";
import { amzDateOf, sha256Hex, signV4 } from "@/lib/server/sigv4";

/**
 * POST /api/pin: pins one evidence photo on Filebase and returns its CID.
 *
 * The body is the JPEG the browser already re-encoded (at most 240 KB, see
 * lib/media/reencode.ts). This handler:
 *
 * 1. computes the raw CIDv1 sha2-256 of the bytes itself (bafkrei...);
 * 2. wraps the bytes in a CARv1 holding that one raw block as its root, so
 *    the service stores exactly this CID (a single raw-leaf block, CIDv1)
 *    instead of choosing its own chunking or CID version;
 * 3. uploads the CAR to a Filebase IPFS bucket through the S3-compatible API
 *    (free plan; the Pinning Service API is paid only) with
 *    `x-amz-meta-import: car`, signed with AWS Signature V4;
 * 4. reads the CID Filebase reports in the `x-amz-meta-cid` response header
 *    (or from a HEAD on the object when the PUT response omits it) and
 *    refuses unless it equals the CID from step 1.
 *
 * The client compares the returned CID with the one it computed as well.
 * The Filebase key never leaves the server: FILEBASE_* variables have no
 * NEXT_PUBLIC_ prefix, so Next.js never inlines them into browser code.
 * The pin belongs to the service account, so a party cannot unpin their
 * own evidence to stall the jury.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 240 * 1024;
const S3_REGION = "us-east-1";
const S3_SERVICE = "s3";
const DEFAULT_ENDPOINT = "https://s3.filebase.com";

// Best effort, per server instance: enough to stop a casual loop from
// filling the bucket, not a substitute for an edge rate limit.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const recentByClient = new Map<string, number[]>();

interface FilebaseConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
  endpoint: string;
}

function filebaseConfig(): FilebaseConfig | null {
  const accessKey = process.env.FILEBASE_ACCESS_KEY;
  const secretKey = process.env.FILEBASE_SECRET_KEY;
  const bucket = process.env.FILEBASE_BUCKET;
  if (!accessKey || !secretKey || !bucket) return null;
  const endpoint = (process.env.FILEBASE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  return { accessKey, secretKey, bucket, endpoint };
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function rateLimited(client: string): boolean {
  const now = Date.now();
  const recent = (recentByClient.get(client) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  const limited = recent.length >= RATE_MAX;
  if (!limited) recent.push(now);
  recentByClient.set(client, recent);
  return limited;
}

/** One signed S3 request against the bucket. */
async function s3(
  cfg: FilebaseConfig,
  method: "PUT" | "HEAD",
  objectKey: string,
  body?: Uint8Array<ArrayBuffer>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = new URL(
    `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${encodeURIComponent(objectKey)}`,
  );
  const headers = signV4({
    method,
    url,
    headers: extraHeaders,
    payloadHash: sha256Hex(body ?? ""),
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    region: S3_REGION,
    service: S3_SERVICE,
    amzDate: amzDateOf(new Date()),
  });
  // fetch sets Host itself; it is signed above and must not be sent twice.
  delete headers.host;
  return fetch(url, { method, headers, body, cache: "no-store" });
}

/** The S3 error code from an XML error body, for a short message. */
async function s3ErrorCode(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function POST(req: NextRequest) {
  const cfg = filebaseConfig();
  if (!cfg) {
    return fail(503, "Photo pinning is not configured on this server.");
  }

  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(client)) {
    return fail(429, "Too many uploads. Wait a few minutes and try again.");
  }

  if (!(req.headers.get("content-type") ?? "").startsWith("image/jpeg")) {
    return fail(415, "Only JPEG images prepared by the upload dialog are accepted.");
  }
  if (Number(req.headers.get("content-length") ?? "0") > MAX_IMAGE_BYTES) {
    return fail(413, "The image is larger than 240 KB.");
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    return fail(413, "The image must be between 1 byte and 240 KB.");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return fail(415, "The body is not a JPEG file.");
  }

  const cid = await rawCidV1(bytes);
  const car = singleBlockCar(cidBytes(cid), bytes);

  let put: Response;
  try {
    put = await s3(cfg, "PUT", cid, car, { "x-amz-meta-import": "car" });
  } catch {
    return fail(502, "Could not reach Filebase.");
  }
  if (!put.ok) {
    return fail(502, `Filebase refused the upload (${await s3ErrorCode(put)}).`);
  }

  let reported = put.headers.get("x-amz-meta-cid");
  if (!reported) {
    try {
      const head = await s3(cfg, "HEAD", cid);
      reported = head.ok ? head.headers.get("x-amz-meta-cid") : null;
    } catch {
      reported = null;
    }
  }
  if (!reported) {
    return fail(502, "Filebase did not report a CID for the upload.");
  }
  if (reported !== cid) {
    return fail(502, `Filebase reported ${reported}, but the bytes hash to ${cid}. Not used.`);
  }

  return NextResponse.json({ cid, size: bytes.length });
}
