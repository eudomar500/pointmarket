import { TransactionHashVariant } from "genlayer-js/types";
import type {
  Address,
  ArbiterContractInfo,
  ContractInfo,
  EscrowContractInfo,
  EscrowEligible,
  EscrowTrade,
  EscrowTradeRaw,
  LacreRecord,
  LegacyListingDetails,
  LegacyMetrics,
  LegacyTradeSummary,
  MarketSummary,
  UserBet,
  UserReputation,
} from "./types";
import {
  arbiterAddress,
  escrowAddress,
  lacreRouterAddress,
  predictionMarketAddress,
  type NetworkKey,
} from "./contracts";
import { parseEscrowTrade } from "./escrow";
import type { Reader } from "./client";

/**
 * Typed wrappers around client.readContract() for every view this app
 * calls. Names mirror the Python contract methods exactly.
 *
 * The SDK returns CalldataEncodable for all reads. We cast via unknown
 * because the runtime shape matches our interfaces (contracts return dicts
 * with the documented field names), but TypeScript cannot verify the
 * structural overlap statically.
 *
 * `final: true` reads at LATEST_FINAL: state that can no longer be appealed
 * away. The Arbiter judges that view, and a Lacre record is proof only
 * there. The default is the latest state, accepted but maybe not final.
 */

interface ReadOptions {
  final?: boolean;
}

function variant(opts?: ReadOptions): TransactionHashVariant {
  return opts?.final ? TransactionHashVariant.LATEST_FINAL : TransactionHashVariant.LATEST_NONFINAL;
}

interface EscrowReadOptions extends ReadOptions {
  /** Read this Escrow (an archived v1.5 one) instead of the network's live Escrow. */
  escrow?: Address;
}

// =============================================================================
// Escrow reads
// =============================================================================

export async function getTradeRaw(
  client: Reader,
  network: NetworkKey,
  tradeId: bigint | number,
  opts?: EscrowReadOptions,
): Promise<EscrowTradeRaw> {
  const result = await client.readContract({
    address: opts?.escrow ?? escrowAddress(network),
    functionName: "get_trade",
    args: [BigInt(tradeId)],
    transactionHashVariant: variant(opts),
  });
  return result as unknown as EscrowTradeRaw;
}

export async function getTrade(
  client: Reader,
  network: NetworkKey,
  tradeId: bigint | number,
  opts?: EscrowReadOptions,
): Promise<EscrowTrade> {
  const raw = await getTradeRaw(client, network, tradeId, opts);
  return parseEscrowTrade(raw, Number(tradeId));
}

export async function getEligible(
  client: Reader,
  network: NetworkKey,
  start: number,
  count: number,
): Promise<EscrowEligible> {
  const result = await client.readContract({
    address: escrowAddress(network),
    functionName: "get_eligible",
    args: [start, count],
  });
  const raw = result as unknown as { total: number; ids: number[] };
  return { total: Number(raw.total), ids: (raw.ids ?? []).map(Number) };
}

export async function getEscrowContractInfo(
  client: Reader,
  network: NetworkKey,
  opts?: EscrowReadOptions,
): Promise<EscrowContractInfo> {
  const result = await client.readContract({
    address: opts?.escrow ?? escrowAddress(network),
    functionName: "get_contract_info",
    args: [],
    transactionHashVariant: variant(opts),
  });
  return result as unknown as EscrowContractInfo;
}

export async function getNextTradeId(
  client: Reader,
  network: NetworkKey,
): Promise<bigint> {
  const info = await getEscrowContractInfo(client, network);
  return BigInt(info.total_trades);
}

// =============================================================================
// Arbiter reads
// =============================================================================

export async function getArbiterContractInfo(
  client: Reader,
  network: NetworkKey,
): Promise<ArbiterContractInfo> {
  const result = await client.readContract({
    address: arbiterAddress(network),
    functionName: "get_contract_info",
    args: [],
  });
  return result as unknown as ArbiterContractInfo;
}

// =============================================================================
// Lacre reads (delivery proof)
// =============================================================================

/** Router.resolve(name): the current address for a name, or "" if none. */
export async function resolveLacreName(
  client: Reader,
  network: NetworkKey,
  name: string,
  opts?: ReadOptions,
): Promise<string> {
  const result = await client.readContract({
    address: lacreRouterAddress(network),
    functionName: "resolve",
    args: [name],
    transactionHashVariant: variant(opts),
  });
  return String(result ?? "");
}

/** Verifier.get(id). Returns null for an unknown record. */
export async function getLacreRecord(
  client: Reader,
  verifier: Address,
  recordId: string,
  opts?: ReadOptions,
): Promise<LacreRecord | null> {
  const result = await client.readContract({
    address: verifier,
    functionName: "get",
    args: [recordId],
    transactionHashVariant: variant(opts),
  });
  const record = result as unknown as Partial<LacreRecord> | null;
  if (!record || !record.id) return null;
  return record as LacreRecord;
}

// =============================================================================
// Legacy Marketplace reads (v1.4.x, read only)
// =============================================================================

export async function getLegacyMetrics(
  client: Reader,
  marketplace: Address,
): Promise<LegacyMetrics> {
  const result = await client.readContract({
    address: marketplace,
    functionName: "get_metrics",
    args: [],
  });
  return result as unknown as LegacyMetrics;
}

export async function getLegacyTradeSummary(
  client: Reader,
  marketplace: Address,
  tradeId: bigint | number,
): Promise<LegacyTradeSummary> {
  const result = await client.readContract({
    address: marketplace,
    functionName: "get_trade_summary",
    args: [BigInt(tradeId)],
  });
  return result as unknown as LegacyTradeSummary;
}

export async function getLegacyListingDetails(
  client: Reader,
  marketplace: Address,
  tradeId: bigint | number,
): Promise<LegacyListingDetails> {
  const result = await client.readContract({
    address: marketplace,
    functionName: "get_listing_details",
    args: [BigInt(tradeId)],
  });
  return result as unknown as LegacyListingDetails;
}

// =============================================================================
// PredictionMarket reads
// =============================================================================

export async function getPredictionMarketContractInfo(
  client: Reader,
  network: NetworkKey,
): Promise<ContractInfo> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "get_contract_info",
    args: [],
  });
  return result as unknown as ContractInfo;
}

export async function isPredictionMarketPaused(
  client: Reader,
  network: NetworkKey,
): Promise<boolean> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "is_paused",
    args: [],
  });
  return result as unknown as boolean;
}

export async function getMarketSummary(
  client: Reader,
  network: NetworkKey,
  marketId: bigint | number,
): Promise<MarketSummary> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "get_market_summary",
    args: [BigInt(marketId)],
  });
  return result as unknown as MarketSummary;
}

export async function getUserBet(
  client: Reader,
  network: NetworkKey,
  marketId: bigint | number,
  user: Address,
): Promise<UserBet> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "get_user_bet",
    args: [BigInt(marketId), user],
  });
  return result as unknown as UserBet;
}

export async function getUserReputation(
  client: Reader,
  network: NetworkKey,
  user: Address,
): Promise<UserReputation> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "get_user_reputation",
    args: [user],
  });
  return result as unknown as UserReputation;
}

export async function getNextMarketId(
  client: Reader,
  network: NetworkKey,
): Promise<bigint> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "get_next_market_id",
    args: [],
  });
  return result as unknown as bigint;
}

export async function getMarketplaceAddress(
  client: Reader,
  network: NetworkKey,
): Promise<Address> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "get_marketplace_address",
    args: [],
  });
  return result as unknown as Address;
}

export async function isPredictionMarketAdmin(
  client: Reader,
  network: NetworkKey,
  address: Address,
): Promise<boolean> {
  const result = await client.readContract({
    address: predictionMarketAddress(network),
    functionName: "is_admin",
    args: [address],
  });
  return result as unknown as boolean;
}
