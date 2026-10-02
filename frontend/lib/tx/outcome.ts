import type { TxRawStatus, TxUiState } from "./types";

/**
 * Reads a receipt's consensus result next to its status.
 *
 * A status alone is not enough on Bradbury: a transaction whose round ended
 * in a validators timeout can still reach FINALIZED, and when it does the
 * messages its leader emitted are dropped. The first v1.5 `resolve` went
 * exactly that way: FINALIZED, no `settle`. So a FINALIZED receipt counts
 * as success only when its consensus result is an agreement and the
 * contract finished with a return, not an error.
 *
 * Index order matches the SDK's TransactionResult and ExecutionResult
 * enums (transactionResultNumberToName, executionResultNumberToName).
 */

export const RESULT_NAMES = [
  "IDLE",
  "AGREE",
  "DISAGREE",
  "TIMEOUT",
  "DETERMINISTIC_VIOLATION",
  "NO_MAJORITY",
  "MAJORITY_AGREE",
  "MAJORITY_DISAGREE",
] as const;

export const EXECUTION_NAMES = [
  "NOT_VOTED",
  "FINISHED_WITH_RETURN",
  "FINISHED_WITH_ERROR",
] as const;

const AGREEMENT = new Set<string>(["AGREE", "MAJORITY_AGREE"]);

export interface ReceiptOutcome {
  uiState: TxUiState;
  resultName?: string;
  executionName?: string;
  /** Set when uiState is "failed": what happened, in plain words. */
  failureReason?: string;
  /** True when nothing was recorded and the same call can be sent again. */
  retryable?: boolean;
}

function nameAt(table: readonly string[], value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? table[n] ?? `UNKNOWN_${n}` : undefined;
}

export function classifyReceipt(
  rawStatus: TxRawStatus,
  result: unknown,
  txExecutionResult: unknown,
): ReceiptOutcome {
  const resultName = nameAt(RESULT_NAMES, result);
  const executionName = nameAt(EXECUTION_NAMES, txExecutionResult);
  const base = { resultName, executionName };

  switch (rawStatus) {
    case "UNINITIALIZED":
    case "PENDING":
    case "PROPOSING":
    case "COMMITTING":
    case "REVEALING":
      return { ...base, uiState: "submitted" };
    case "ACCEPTED":
    case "READY_TO_FINALIZE":
    case "APPEAL_REVEALING":
    case "APPEAL_COMMITTING":
      return { ...base, uiState: "accepted" };
    case "VALIDATORS_TIMEOUT":
    case "LEADER_TIMEOUT":
      return {
        ...base,
        uiState: "failed",
        failureReason: `Consensus timed out (${rawStatus}). Nothing was recorded.`,
        retryable: true,
      };
    case "UNDETERMINED":
      return {
        ...base,
        uiState: "failed",
        failureReason: "Validators could not agree (UNDETERMINED). Nothing was recorded.",
        retryable: true,
      };
    case "CANCELED":
      return { ...base, uiState: "failed", failureReason: "The transaction was canceled." };
    case "FINALIZED": {
      if (resultName !== undefined && !AGREEMENT.has(resultName)) {
        return {
          ...base,
          uiState: "failed",
          failureReason: `Finalized without agreement (${resultName}). Nothing it emitted was delivered.`,
          retryable: true,
        };
      }
      if (executionName === "FINISHED_WITH_ERROR") {
        return {
          ...base,
          uiState: "failed",
          failureReason:
            "The contract refused the call. Its state did not change; on Bradbury any value sent with it is not returned.",
        };
      }
      return { ...base, uiState: "finalized" };
    }
  }
}
