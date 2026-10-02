import type { Address, EscrowTrade } from "./types";
import { ClaimKind, TradeState, TRADE_STATE_LABELS, type TradeStateValue } from "./types";
import type { NetworkKey } from "./contracts";
import type { Reader } from "./client";
import { getEscrowContractInfo, getTrade } from "./reads";
import { BUYER_BOND, STATEMENT_MAX, nowSeconds, sameAddress, sellerBond } from "./escrow";
import { isRawCidV1 } from "../media/cid";
import { formatGenBalance } from "../wallet/format";

/**
 * Pre-checks for the three payable Escrow writes.
 *
 * On Bradbury a payable call that reverts keeps its value. 0.015 GEN is
 * stranded in the first demo Escrow that way. So before any value is sent
 * we read the trade again and refuse unless every condition the contract
 * checks also holds here: state, the caller's role, the window and the
 * exact amount. The value we return is computed from that fresh read.
 *
 * Deadlines get a safety margin: the transaction executes when validators
 * pick it up, not when it is signed, and a call that lands one second late
 * reverts and keeps the bond.
 */

export const DEADLINE_MARGIN_SECONDS = 300;

export class PrecheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrecheckError";
  }
}

export interface Checked {
  trade: EscrowTrade;
  value: bigint;
}

/** Python's len() counts code points, not UTF-16 units. */
export function codePoints(text: string): number {
  return Array.from(text).length;
}

function stateLabel(state: number): string {
  return TRADE_STATE_LABELS[state as TradeStateValue] ?? `state ${state}`;
}

function requireState(trade: EscrowTrade, state: number, action: string): void {
  if (trade.state !== state) {
    throw new PrecheckError(
      `Cannot ${action}: trade #${trade.id} is ${stateLabel(trade.state)}, not ${stateLabel(state)}. Nothing was sent.`,
    );
  }
}

function requireBefore(deadline: number, what: string): void {
  const now = nowSeconds();
  if (deadline === 0 || now >= deadline) {
    throw new PrecheckError(`The ${what} has closed. Nothing was sent.`);
  }
  if (deadline - now < DEADLINE_MARGIN_SECONDS) {
    throw new PrecheckError(
      `The ${what} closes in under ${DEADLINE_MARGIN_SECONDS / 60} minutes. A transaction this close to the deadline can land after it and lose the bond, so it was not sent.`,
    );
  }
}

function requireStatement(statement: string): void {
  const n = codePoints(statement);
  if (n < 1 || n > STATEMENT_MAX) {
    throw new PrecheckError(`The statement must be 1 to ${STATEMENT_MAX} characters. Nothing was sent.`);
  }
}

function requireCid(cid: string): void {
  if (cid !== "" && !isRawCidV1(cid)) {
    throw new PrecheckError("The photo CID is not a raw CIDv1 (bafkrei...). Nothing was sent.");
  }
}

async function requireUnpaused(client: Reader, network: NetworkKey): Promise<void> {
  const info = await getEscrowContractInfo(client, network);
  if (info.paused) {
    throw new PrecheckError("The Escrow is paused by its admin. Nothing was sent.");
  }
}

export async function precheckAcceptListing(
  client: Reader,
  network: NetworkKey,
  args: { tradeId: bigint; sender: Address; expectedPrice: bigint },
): Promise<Checked> {
  const trade = await getTrade(client, network, args.tradeId);
  requireState(trade, TradeState.LISTING_OPEN, "buy this listing");
  if (sameAddress(args.sender, trade.seller)) {
    throw new PrecheckError("You are the seller of this listing. Nothing was sent.");
  }
  if (trade.price !== args.expectedPrice) {
    throw new PrecheckError(
      `The price on chain is ${formatGenBalance(trade.price)}, not the ${formatGenBalance(args.expectedPrice)} shown. Reload the page. Nothing was sent.`,
    );
  }
  await requireUnpaused(client, network);
  return { trade, value: trade.price };
}

export async function precheckOpenDispute(
  client: Reader,
  network: NetworkKey,
  args: { tradeId: bigint; sender: Address; claimKind: number; statement: string; cid: string },
): Promise<Checked> {
  const trade = await getTrade(client, network, args.tradeId);
  requireState(trade, TradeState.SHIPPED, "open a dispute");
  if (!sameAddress(args.sender, trade.buyer)) {
    throw new PrecheckError("Only the buyer can open a dispute. Nothing was sent.");
  }
  const kinds: number[] = Object.values(ClaimKind);
  if (!kinds.includes(args.claimKind)) {
    throw new PrecheckError("Choose what went wrong: not received, damaged or not as described.");
  }
  requireStatement(args.statement);
  requireCid(args.cid);
  requireBefore(trade.claimAt, "dispute window");
  await requireUnpaused(client, network);
  return { trade, value: BUYER_BOND };
}

export async function precheckRespondToDispute(
  client: Reader,
  network: NetworkKey,
  args: { tradeId: bigint; sender: Address; statement: string; cid: string },
): Promise<Checked> {
  const trade = await getTrade(client, network, args.tradeId);
  requireState(trade, TradeState.DISPUTED, "respond");
  if (!sameAddress(args.sender, trade.seller)) {
    throw new PrecheckError("Only the seller can respond to this dispute. Nothing was sent.");
  }
  if (trade.responded) {
    throw new PrecheckError("The seller has already responded to this dispute. Nothing was sent.");
  }
  requireStatement(args.statement);
  requireCid(args.cid);
  requireBefore(trade.responseUntil, "response window");
  const value = sellerBond(trade.price);
  if (value <= 0n) {
    throw new PrecheckError("The seller bond computes to zero for this price. Nothing was sent.");
  }
  return { trade, value };
}
