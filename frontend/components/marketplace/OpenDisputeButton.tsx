"use client";

import { useState } from "react";
import { useOpenDispute } from "@/lib/hooks/useOpenDispute";
import { useWalletStore } from "@/lib/wallet/store";
import { useCountdown, formatRemaining } from "@/lib/hooks/useCountdown";
import { BUYER_BOND, sameAddress } from "@/lib/genlayer/escrow";
import DisputeEvidenceDialog from "./DisputeEvidenceDialog";
import type { TxMethod } from "@/lib/tx/types";

const METHOD: TxMethod = "open_dispute";

interface OpenDisputeButtonProps {
  tradeId: number;
  buyer: string;
  state: number;
  /** Escrow claim_at: the buyer's last moment to dispute. */
  claimAt: number;
  price: bigint;
  title: string;
  disabled?: boolean;
  activeMethod?: string | null;
}

/** v1.5: only the buyer opens a dispute, on a SHIPPED trade, before claim_at. */
export default function OpenDisputeButton({
  tradeId,
  buyer,
  state,
  claimAt,
  price,
  title,
  disabled,
  activeMethod,
}: OpenDisputeButtonProps) {
  const { address, status } = useWalletStore();
  const { openDispute } = useOpenDispute();
  const [open, setOpen] = useState(false);

  // No safety buffer here: the deadline is a close, not an unlock.
  const { remainingSeconds, isReady: windowClosed } = useCountdown(claimAt, 0);

  const connected = status === "connected" && address;
  const isBuyer = connected && sameAddress(address, buyer);
  const isShipped = state === 2;

  if (!isBuyer || !isShipped || windowClosed) {
    return null;
  }

  const buttonLabel =
    disabled && activeMethod === METHOD
      ? "Processing..."
      : `Open dispute (${formatRemaining(remainingSeconds)} left)`;

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-transparent text-[var(--text-primary)] font-medium hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </button>
      {open ? (
        <DisputeEvidenceDialog
          mode="open"
          tradeId={tradeId}
          title={title}
          price={price}
          bond={BUYER_BOND}
          onClose={() => setOpen(false)}
          onSubmit={({ claimKind, statement, cid }) =>
            openDispute({ tradeId, claimKind, statement, cid })
          }
        />
      ) : null}
    </div>
  );
}
