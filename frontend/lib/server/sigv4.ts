import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible APIs (Filebase), server side.
 * Header-based signing with a signed payload hash. Pure apart from
 * node:crypto, so it can be checked against the AWS documentation vectors.
 */

export const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign, besides host, x-amz-date and x-amz-content-sha256. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  /** YYYYMMDDTHHMMSSZ. */
  amzDate: string;
}

export function amzDateOf(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Returns every signed header plus `authorization`. `host` is included
 * because it is signed; a fetch caller drops it, since fetch sets Host.
 */
export function signV4(input: SignInput): Record<string, string> {
  const day = input.amzDate.slice(0, 8);
  const signed: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
  };
  for (const [k, v] of Object.entries(input.headers ?? {})) signed[k.toLowerCase()] = v;

  const names = Object.keys(signed).sort();
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    query,
    names.map((n) => `${n}:${signed[n].trim()}\n`).join(""),
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac("AWS4" + input.secretKey, day);
  const kSigning = hmac(hmac(hmac(kDate, input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    ...signed,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
