import type { Address } from "./types";
import {
  arbiterAddress,
  escrowAddress,
  predictionMarketAddress,
  type NetworkKey,
} from "./contracts";
import {
  precheckAcceptListing,
  precheckOpenDispute,
  precheckRespondToDispute,
} from "./precheck";
import type { WriteClient } from "./client";

/**
 * Typed wrappers around client.writeContract() for every state-modifying
 * method this app can call. Each returns the transaction hash; the tx
 * poller tracks the lifecycle from there.
 *
 * Payable writes. On Bradbury a payable call that reverts keeps its value:
 * it is not returned to the sender. So the three payable Escrow writes are
 * only exported in a checked form. Each one reads get_trade right before
 * signing, refuses unless the state, the caller's role, the window and the
 * amount all hold (precheck.ts), and takes the value from that fresh read,
 * never from the caller. There is deliberately no unchecked variant.
 */

const ZERO_VALUE = 0n;

async function send(
  client: WriteClient,
  address: Address,
  functionName: string,
  args: Parameters<WriteClient["writeContract"]>[0]["args"],
  value: bigint = ZERO_VALUE,
): Promise<string> {
  const hash = await client.writeContract({ address, functionName, args, value });
  return String(hash);
}

// =============================================================================
// Escrow writes
// =============================================================================

export async function createListing(
  client: WriteClient,
  network: NetworkKey,
  args: { title: string; description: string; price: bigint; listingMediaCid: string },
): Promise<string> {
  return send(client, escrowAddress(network), "create_listing", [
    args.title,
    args.description,
    args.price,
    args.listingMediaCid,
  ]);
}

export async function cancelListing(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "cancel_listing", [tradeId]);
}

/** Payable, checked: value is the trade price read right before signing. */
export async function acceptListing(
  client: WriteClient,
  network: NetworkKey,
  args: { tradeId: bigint; sender: Address; expectedPrice: bigint },
): Promise<string> {
  const { value } = await precheckAcceptListing(client, network, args);
  return send(client, escrowAddress(network), "accept_listing", [args.tradeId], value);
}

export async function markShipped(
  client: WriteClient,
  network: NetworkKey,
  args: {
    tradeId: bigint;
    trackingNumber: string;
    trackingCarrier: string;
    carrierDomains: string[];
    packingMediaCid: string;
  },
): Promise<string> {
  return send(client, escrowAddress(network), "mark_shipped", [
    args.tradeId,
    args.trackingNumber,
    args.trackingCarrier,
    args.carrierDomains.join(","),
    args.packingMediaCid,
  ]);
}

export async function confirmDelivery(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "confirm_delivery", [tradeId]);
}

export async function claimAfterWindow(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "claim_after_window", [tradeId]);
}

export async function claimUnshippedRefund(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "claim_unshipped_refund", [tradeId]);
}

export async function setUnboxingMedia(
  client: WriteClient,
  network: NetworkKey,
  args: { tradeId: bigint; cid: string },
): Promise<string> {
  return send(client, escrowAddress(network), "set_unboxing_media", [args.tradeId, args.cid]);
}

/** Payable, checked: value is BUYER_BOND, sent only after precheckOpenDispute. */
export async function openDispute(
  client: WriteClient,
  network: NetworkKey,
  args: { tradeId: bigint; sender: Address; claimKind: number; statement: string; cid: string },
): Promise<string> {
  const { value } = await precheckOpenDispute(client, network, args);
  return send(
    client,
    escrowAddress(network),
    "open_dispute",
    [args.tradeId, args.claimKind, args.statement, args.cid],
    value,
  );
}

/** Payable, checked: value is price * 5% from the fresh read. */
export async function respondToDispute(
  client: WriteClient,
  network: NetworkKey,
  args: { tradeId: bigint; sender: Address; statement: string; cid: string },
): Promise<string> {
  const { value } = await precheckRespondToDispute(client, network, args);
  return send(
    client,
    escrowAddress(network),
    "respond_to_dispute",
    [args.tradeId, args.statement, args.cid],
    value,
  );
}

/**
 * Escrow.settle accepts calls from the Arbiter only. It is wrapped for ABI
 * completeness; sent from a wallet it reverts with `not arbiter`.
 */
export async function settle(
  client: WriteClient,
  network: NetworkKey,
  args: { tradeId: bigint; buyerWins: boolean; reasoningHash: string },
): Promise<string> {
  return send(client, escrowAddress(network), "settle", [
    args.tradeId,
    args.buyerWins,
    args.reasoningHash,
  ]);
}

export async function claimDisputeDefault(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "claim_dispute_default", [tradeId]);
}

export async function forceRefundStuckDispute(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "force_refund_stuck_dispute", [tradeId]);
}

export async function claimStuckDisputeRefund(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, escrowAddress(network), "claim_stuck_dispute_refund", [tradeId]);
}

export async function submitDeliveryProof(
  client: WriteClient,
  network: NetworkKey,
  args: { tradeId: bigint; recordId: string },
): Promise<string> {
  return send(client, escrowAddress(network), "submit_delivery_proof", [
    args.tradeId,
    args.recordId,
  ]);
}

// Escrow admin writes.

export async function setArbiter(
  client: WriteClient,
  network: NetworkKey,
  arbiter: Address,
): Promise<string> {
  return send(client, escrowAddress(network), "set_arbiter", [arbiter]);
}

export async function pauseEscrow(client: WriteClient, network: NetworkKey): Promise<string> {
  return send(client, escrowAddress(network), "pause", []);
}

export async function unpauseEscrow(client: WriteClient, network: NetworkKey): Promise<string> {
  return send(client, escrowAddress(network), "unpause", []);
}

export async function withdrawFees(
  client: WriteClient,
  network: NetworkKey,
  args: { recipient: Address; amount: bigint },
): Promise<string> {
  return send(client, escrowAddress(network), "withdraw_fees", [args.recipient, args.amount]);
}

export async function transferEscrowAdmin(
  client: WriteClient,
  network: NetworkKey,
  newAdmin: Address,
): Promise<string> {
  return send(client, escrowAddress(network), "transfer_admin", [newAdmin]);
}

export async function acceptEscrowAdmin(client: WriteClient, network: NetworkKey): Promise<string> {
  return send(client, escrowAddress(network), "accept_admin", []);
}

export async function cancelEscrowPendingAdmin(
  client: WriteClient,
  network: NetworkKey,
): Promise<string> {
  return send(client, escrowAddress(network), "cancel_pending_admin", []);
}

export async function proposeEscrowUpgrade(
  client: WriteClient,
  network: NetworkKey,
  newCode: Uint8Array,
): Promise<string> {
  return send(client, escrowAddress(network), "propose_upgrade", [newCode]);
}

export async function executeEscrowUpgrade(
  client: WriteClient,
  network: NetworkKey,
): Promise<string> {
  return send(client, escrowAddress(network), "execute_upgrade", []);
}

export async function cancelEscrowPendingUpgrade(
  client: WriteClient,
  network: NetworkKey,
): Promise<string> {
  return send(client, escrowAddress(network), "cancel_pending_upgrade", []);
}

// =============================================================================
// Arbiter writes
// =============================================================================

/** Anyone may call. Returns {buyer_wins, reasoning} in the receipt. */
export async function resolve(
  client: WriteClient,
  network: NetworkKey,
  tradeId: bigint,
): Promise<string> {
  return send(client, arbiterAddress(network), "resolve", [tradeId]);
}

// =============================================================================
// PredictionMarket writes
// =============================================================================

export async function createSubjectiveMarket(
  client: WriteClient,
  network: NetworkKey,
  args: {
    question: string;
    metricType: number;
    targetTradeId: bigint;
    bettingCloseAt: bigint;
    settlementAt: bigint;
  },
): Promise<string> {
  return send(client, predictionMarketAddress(network), "create_subjective_market", [
    args.question,
    args.metricType,
    args.targetTradeId,
    args.bettingCloseAt,
    args.settlementAt,
  ]);
}

export async function createObjectiveMarket(
  client: WriteClient,
  network: NetworkKey,
  args: {
    question: string;
    metricType: number;
    threshold: bigint;
    windowStart: bigint;
    windowEnd: bigint;
    bettingCloseAt: bigint;
    settlementAt: bigint;
  },
): Promise<string> {
  return send(client, predictionMarketAddress(network), "create_objective_market", [
    args.question,
    args.metricType,
    args.threshold,
    args.windowStart,
    args.windowEnd,
    args.bettingCloseAt,
    args.settlementAt,
  ]);
}

export async function placeBet(
  client: WriteClient,
  network: NetworkKey,
  args: { marketId: bigint; predictYes: boolean; value: bigint },
): Promise<string> {
  return send(
    client,
    predictionMarketAddress(network),
    "place_bet",
    [args.marketId, args.predictYes],
    args.value,
  );
}

export async function resolveMarket(
  client: WriteClient,
  network: NetworkKey,
  marketId: bigint,
): Promise<string> {
  return send(client, predictionMarketAddress(network), "resolve_market", [marketId]);
}

export async function claimWinnings(
  client: WriteClient,
  network: NetworkKey,
  marketId: bigint,
): Promise<string> {
  return send(client, predictionMarketAddress(network), "claim_winnings", [marketId]);
}

export async function refundBet(
  client: WriteClient,
  network: NetworkKey,
  marketId: bigint,
): Promise<string> {
  return send(client, predictionMarketAddress(network), "refund_bet", [marketId]);
}

export async function pausePredictionMarket(
  client: WriteClient,
  network: NetworkKey,
): Promise<string> {
  return send(client, predictionMarketAddress(network), "pause", []);
}

export async function unpausePredictionMarket(
  client: WriteClient,
  network: NetworkKey,
): Promise<string> {
  return send(client, predictionMarketAddress(network), "unpause", []);
}
