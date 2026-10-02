"use client";

import { useQuery } from "@tanstack/react-query";
import { DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { getArbiterContractInfo, getEscrowContractInfo } from "@/lib/genlayer/reads";
import { createReadClient } from "@/lib/genlayer/client";

/** Escrow.get_contract_info: admin, paused, arbiter, carrier domains, totals. */
export function useEscrowInfo() {
  return useQuery({
    queryKey: ["escrow", "info"],
    queryFn: () => getEscrowContractInfo(createReadClient(DEFAULT_NETWORK), DEFAULT_NETWORK),
    staleTime: 30_000,
  });
}

/** Arbiter.get_contract_info: version, escrow, admin, paused. */
export function useArbiterInfo() {
  return useQuery({
    queryKey: ["arbiter", "info"],
    queryFn: () => getArbiterContractInfo(createReadClient(DEFAULT_NETWORK), DEFAULT_NETWORK),
    staleTime: 60_000,
  });
}
