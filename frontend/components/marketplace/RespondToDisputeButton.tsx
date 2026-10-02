"use client";

import { useState } from "react";
import { useRespondToDispute } from "@/lib/hooks/useRespondToDispute";
import { useWalletStore } from "@/lib/wallet/store";
import { useCountdown, formatRemaining } from "@/lib/hooks/useCountdown";
import { sameAddress, sellerBond } from "@/lib/genlayer/escrow";
import DisputeEvidenceDialog from "./DisputeEvidenceDialog";
import type { TxMethod } from "@/lib/tx/types";

const METHOD: TxMethod = "respond_to_dispute";

interface RespondToDisputeButtonProps {
  tradeId: number;
  seller: string;
  state: number;
  responded: boolean;
  /** Escrow response_until: disputed_at + DISPUTE_RESPONSE_WINDOW. */
  responseUntil: number;
  price: bigint;
  title: string;
  disabled?: boolean;
  activeMethod?: string | null;
}

/** v1.5: the seller answers once, before response_until, with a 5% bond. */
export default function RespondToDisputeButton({
  tradeId,
  seller,
  state,
  responded,
  responseUntil,
  price,
  title,
  disabled,
  activeMethod,
}: RespondToDisputeButtonProps) {
  const { address, status } = useWalletStore();
  const { respondToDispute } = useRespondToDispute();
  const [open, setOpen] = useState(false);
  const { remainingSeconds, isReady: windowClosed } = useCountdown(responseUntil, 0);

  const connected = status === "connected" && address;
  const isSeller = connected && sameAddress(address, seller);
  const isDisputed = state === 3;

  if (!isSeller || !isDisputed || responded || windowClosed) {
    return null;
  }

  const bond = sellerBond(price);
  const buttonLabel =
    disabled && activeMethod === METHOD
      ? "Processing..."
      : `Respond to dispute (${formatRemaining(remainingSeconds)} left)`;

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonLabel}
      </button>
      {open ? (
        <DisputeEvidenceDialog
          mode="respond"
          tradeId={tradeId}
          title={title}
          price={price}
          bond={bond}
          onClose={() => setOpen(false)}
          onSubmit={({ statement, cid }) => respondToDispute({ tradeId, statement, cid })}
        />
      ) : null}
    </div>
  );
}
