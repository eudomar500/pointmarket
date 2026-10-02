import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

/**
 * Raw CIDv1 over sha2-256, the only CID the Escrow accepts: 59 characters,
 * prefix "bafkrei", base32 that decodes to 01 55 12 20 plus a 32-byte
 * digest. The digest is the sha256 of the file itself, so anyone (the jury
 * included) can check gateway bytes against the CID without trusting the
 * gateway. Works in the browser and in the Node route handler.
 */

const SHA2_256 = 0x12;

export const IPFS_GATEWAY = "https://ipfs.filebase.io/ipfs/";

export async function rawCidV1(bytes: Uint8Array): Promise<string> {
  const digest = await sha256.digest(bytes);
  return CID.create(1, raw.code, digest).toString();
}

/** Mirrors Escrow._cid: the canonical lower-case spelling only. */
export function isRawCidV1(value: string): boolean {
  if (value.length !== 59 || !value.startsWith("bafkrei")) return false;
  try {
    const cid = CID.parse(value);
    return (
      cid.version === 1 &&
      cid.code === raw.code &&
      cid.multihash.code === SHA2_256 &&
      cid.multihash.size === 32 &&
      cid.toString() === value
    );
  } catch {
    return false;
  }
}

/** The CID's binary form (36 bytes for a raw sha2-256 CIDv1). */
export function cidBytes(value: string): Uint8Array {
  return CID.parse(value).bytes;
}

export function ipfsUrl(cid: string): string {
  return IPFS_GATEWAY + cid;
}
