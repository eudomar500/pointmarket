"use client";

import { useState } from "react";
import { useWalletStore } from "@/lib/wallet/store";
import { useTxStore } from "@/lib/tx/store";
import { createWriteClient, type WriteClient } from "@/lib/genlayer/client";
import { DEFAULT_NETWORK, type NetworkKey } from "@/lib/genlayer/contracts";
import type { TxMethod } from "@/lib/tx/types";
import type { Address } from "@/lib/genlayer/types";

interface ExecuteParams {
  method: TxMethod;
  context?: string;
  /**
   * Builds and sends the transaction. `sender` is the connected address the
   * client signs with; payable writes pass it to their pre-checks.
   */
  write: (client: WriteClient, network: NetworkKey, sender: Address) => Promise<string>;
}

export function useWriteWithTracking() {
  const { address, chainId, status } = useWalletStore();
  const { addTx } = useTxStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = async ({ method, context, write }: ExecuteParams): Promise<string> => {
    if (status !== "connected" || !address) {
      throw new Error("Wallet not connected");
    }
    if (chainId !== 4221) {
      throw new Error("Wrong network: must be on Bradbury testnet");
    }

    setPending(true);
    setError(null);

    try {
      const sender = address as Address;
      const client = createWriteClient(DEFAULT_NETWORK, sender);
      const txHash = await write(client, DEFAULT_NETWORK, sender);

      addTx({
        txHash,
        method,
        uiState: "submitted",
        rawStatus: "PENDING",
        submittedAt: Date.now(),
        lastPolledAt: 0,
        context,
      });

      return txHash;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setPending(false);
    }
  };

  return { execute, pending, error };
}
