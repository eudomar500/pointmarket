"use client";
import { useTxStore } from "./store";
import {
  type PendingTx,
  type TxRawStatus,
  TX_POLL_INTERVAL_MS,
} from "./types";
import { classifyReceipt } from "./outcome";
import { createReadClient } from "../genlayer/client";
import { DEFAULT_NETWORK } from "../genlayer/contracts";


/**
 * Centralized polling loop for tracked transactions.
 *
 * The poller queries the RPC for every active TX (not yet finalized or
 * failed) at TX_POLL_INTERVAL_MS intervals. State updates flow into the
 * store, which the UI subscribes to.
 *
 * Design notes:
 *
 * - A single setInterval handles all active TXs, not one per TX. This
 *   keeps the timer count constant regardless of how many TXs the user
 *   has pending.
 *
 * - Each per-TX query runs concurrently with Promise.allSettled, so a
 *   slow or failing RPC call for one TX does not delay the others. If
 *   a tick takes longer than the interval, the next tick still fires
 *   on schedule and works on fresh data from the store.
 *
 * - Errors are logged but never thrown. A transient RPC failure should
 *   not stop the poller; we just retry on the next tick.
 *
 * - Polling stops at FINALIZED, CANCELED, UNDETERMINED,
 *   VALIDATORS_TIMEOUT or LEADER_TIMEOUT. FINALIZED is not success by
 *   itself: classifyReceipt (lib/tx/outcome.ts) also reads the consensus
 *   result and the execution result, and a FINALIZED receipt without an
 *   agreement or with a contract error lands in `failed`.
 */

/**
 * Local mapping from the numeric `status` field in receipts to the
 * GenLayer protocol state names. The SDK declares
 * `transactionsStatusNumberToName` but does not re-export it from the
 * package index, and `receipt.statusName` arrives undefined in practice
 * even though the SDK source claims to populate it. Maintaining this
 * array locally keeps the poller robust to SDK shape changes.
 *
 * Index order matches the TransactionStatus enum in the SDK.
 */
export const STATUS_NAMES: TxRawStatus[] = [
  "UNINITIALIZED",
  "PENDING",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "ACCEPTED",
  "UNDETERMINED",
  "FINALIZED",
  "CANCELED",
  "APPEAL_REVEALING",
  "APPEAL_COMMITTING",
  "READY_TO_FINALIZE",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
];

/** A receipt snapshot as a store patch: status, consensus result, outcome. */
export function receiptToPatch(
  receipt: { status?: unknown; result?: unknown; txExecutionResult?: unknown },
  previous?: PendingTx,
): Partial<Omit<PendingTx, "txHash">> {
  const statusNum = typeof receipt.status === "number" ? receipt.status : Number(receipt.status ?? 0);
  const rawStatus = (STATUS_NAMES[statusNum] ?? "UNINITIALIZED") as TxRawStatus;
  const outcome = classifyReceipt(rawStatus, receipt.result, receipt.txExecutionResult);
  const terminal = outcome.uiState === "finalized" || outcome.uiState === "failed";
  return {
    rawStatus,
    uiState: outcome.uiState,
    resultName: outcome.resultName,
    executionName: outcome.executionName,
    failureReason: outcome.failureReason,
    retryable: outcome.retryable,
    decidedAt: terminal ? previous?.decidedAt ?? Date.now() : undefined,
  };
}

/**
 * Polls a single TX once and updates the store with the latest state.
 * Returns silently if the TX is no longer tracked (e.g. user removed it
 * between scheduling and execution).
 */
async function pollOne(txHash: string): Promise<void> {
  const store = useTxStore.getState();
  const tracked = store.txs.find((t) => t.txHash === txHash);
  if (!tracked) return;

  try {
    const client = createReadClient(DEFAULT_NETWORK);
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as unknown as `0x${string}` & { length: 66 },
      // retries: 1 so the SDK does not block on the Finality Window;
      // we just want the current status snapshot.
      retries: 1,
      interval: 1000,
    });

    store.updateTx(txHash, {
      ...receiptToPatch(receipt, tracked),
      lastPolledAt: Date.now(),
    });
  } catch (err) {
    // Transient RPC errors are expected; just retry on the next tick.
    // We still update lastPolledAt so the UI knows we tried.
    if (typeof window !== "undefined" && window.location.search.includes("debug")) {
      console.warn(`[tx-poller] poll failed for ${txHash}:`, err);
    }
    store.updateTx(txHash, { lastPolledAt: Date.now() });
  }
}

/**
 * Runs one polling pass over all active TXs in parallel.
 */
async function pollAll(): Promise<void> {
  const activeTxs = useTxStore
    .getState()
    .txs.filter((t) => t.uiState !== "finalized" && t.uiState !== "failed");

  if (activeTxs.length === 0) return;

  await Promise.allSettled(activeTxs.map((t) => pollOne(t.txHash)));
}

let pollerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the global polling loop. Idempotent: calling it twice has no
 * additional effect. Call once at app mount.
 *
 * Returns a `stop` function for symmetry; in practice the app does not
 * need to stop the poller, but stopping is useful for tests.
 */
export function startTxPoller(): () => void {
  if (pollerHandle !== null) {
    return stopTxPoller;
  }
  // Kick off an immediate poll on start so the user sees state without
  // waiting a full interval after returning to a tab.
  void pollAll();
  pollerHandle = setInterval(() => {
    void pollAll();
  }, TX_POLL_INTERVAL_MS);
  return stopTxPoller;
}

export function stopTxPoller(): void {
  if (pollerHandle !== null) {
    clearInterval(pollerHandle);
    pollerHandle = null;
  }
}
