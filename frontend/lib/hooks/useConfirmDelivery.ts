"use client";

import { useWriteWithTracking } from "@/lib/tx/useWriteWithTracking";
import { confirmDelivery as confirmDeliveryWrite } from "@/lib/genlayer/writes";

/**
 * Escrow confirm_delivery. Buyer only, on a SHIPPED trade; moves it to
 * COMPLETED and pays the seller the price minus the 2% fee. The payment
 * is an external message that settles when the transaction finalizes.
 */
export function useConfirmDelivery() {
  const { execute, pending, error } = useWriteWithTracking();

  const confirmDelivery = async (tradeId: number): Promise<string> =>
    execute({
      method: "confirm_delivery",
      context: `Trade #${tradeId}`,
      write: (client, network) => confirmDeliveryWrite(client, network, BigInt(tradeId)),
    });

  return { confirmDelivery, pending, error };
}
