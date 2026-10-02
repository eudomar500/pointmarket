"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { getLacreRecord, resolveLacreName } from "@/lib/genlayer/reads";
import { createReadClient } from "@/lib/genlayer/client";
import type { Address, LacreRecord } from "@/lib/genlayer/types";

export interface LacreLookup {
  /** The Verifier the Router resolves now, or null if it names none. */
  verifier: Address | null;
  record: LacreRecord | null;
  /**
   * True when the record was read at LATEST_FINAL. A record seen only at
   * the latest state is provisional: the Escrow reads LATEST_FINAL and
   * would refuse it, and Lacre records take about 35 minutes to finalize.
   */
  final: boolean;
}

/**
 * Resolves `verifier` through the Lacre Router and reads one record from
 * it, final view first. Resolved on every lookup and never cached, as the
 * Escrow does.
 */
export function useLacreRecord(recordId: string) {
  const id = recordId.trim();
  return useQuery<LacreLookup>({
    queryKey: ["lacre", "record", id],
    queryFn: async (): Promise<LacreLookup> => {
      const client = createReadClient(DEFAULT_NETWORK);
      const found = await resolveLacreName(client, DEFAULT_NETWORK, "verifier", { final: true });
      if (!found) return { verifier: null, record: null, final: false };
      const verifier = found as Address;
      const finalRecord = await getLacreRecord(client, verifier, id, { final: true });
      if (finalRecord) return { verifier, record: finalRecord, final: true };
      const latest = await getLacreRecord(client, verifier, id);
      return { verifier, record: latest, final: false };
    },
    enabled: /^\d+$/.test(id),
    staleTime: 60_000,
  });
}
