/**
 * A CARv1 file holding exactly one raw block, its CID as the only root.
 * Uploading this (instead of the bare file) pins exactly the CID we
 * computed: the service imports our block as is, with no chunking or CID
 * version choice of its own. No dependencies, so it is testable alone.
 */

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Unsigned LEB128, as CAR section lengths use. */
export function varint(n: number): Uint8Array {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Uint8Array.from(out);
}

const ascii = (s: string) => new TextEncoder().encode(s);

/**
 * Header: varint length, then DAG-CBOR {"roots": [root], "version": 1},
 * keys in canonical order. A CID in DAG-CBOR is tag 42 over a byte string
 * of 0x00 followed by the binary CID. Written for the 36-byte raw sha2-256
 * CIDv1 (37 bytes with the prefix, so the one-byte length form 0x58 fits).
 */
export function carHeader(root: Uint8Array): Uint8Array {
  if (root.length + 1 > 0xff) throw new Error("CID too long for this encoder");
  const cid = concat(Uint8Array.of(0xd8, 0x2a, 0x58, root.length + 1, 0x00), root);
  const body = concat(
    Uint8Array.of(0xa2, 0x65),
    ascii("roots"),
    Uint8Array.of(0x81),
    cid,
    Uint8Array.of(0x67),
    ascii("version"),
    Uint8Array.of(0x01),
  );
  return concat(varint(body.length), body);
}

/** Header, then one section: varint(len(cid) + len(block)), cid, block. */
export function singleBlockCar(root: Uint8Array, block: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(carHeader(root), varint(root.length + block.length), root, block);
}
