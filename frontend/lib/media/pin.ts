import { rawCidV1 } from "./cid";

/**
 * Pins prepared JPEG bytes through /api/pin and returns the CID only when
 * the service's CID equals the one computed here from the same bytes. The
 * CID ends up in a contract call and the jury checks gateway bytes against
 * it, so a CID this browser did not compute itself is never used.
 */
export async function pinImage(bytes: Uint8Array): Promise<string> {
  const expected = await rawCidV1(bytes);

  let res: Response;
  try {
    res = await fetch("/api/pin", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: new Blob([bytes as BlobPart], { type: "image/jpeg" }),
    });
  } catch {
    throw new Error("Could not reach the pinning service. Check your connection and try again.");
  }

  let payload: { cid?: string; error?: string } = {};
  try {
    payload = await res.json();
  } catch {
    // Handled below as a failed response.
  }
  if (!res.ok || !payload.cid) {
    throw new Error(payload.error || `Pinning failed (HTTP ${res.status}).`);
  }
  if (payload.cid !== expected) {
    throw new Error(
      `The pinning service returned ${payload.cid}, but these bytes hash to ${expected}. The photo was not used.`,
    );
  }
  return expected;
}
