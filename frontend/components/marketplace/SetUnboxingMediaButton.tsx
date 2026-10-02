"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useWalletStore } from "@/lib/wallet/store";
import { useSetUnboxingMedia } from "@/lib/hooks/useSetUnboxingMedia";
import { useCountdown, formatRemaining } from "@/lib/hooks/useCountdown";
import { sameAddress } from "@/lib/genlayer/escrow";
import { getEscrowTimings } from "@/lib/genlayer/timings";
import { DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { NETWORKS } from "@/config/networks";
import { TradeState, type EscrowTrade } from "@/lib/genlayer/types";
import MediaUpload from "@/components/media/MediaUpload";
import type { TxMethod } from "@/lib/tx/types";

const METHOD: TxMethod = "set_unboxing_media";

interface SetUnboxingMediaButtonProps {
  trade: EscrowTrade;
  disabled?: boolean;
  activeMethod?: string | null;
}

/** When the buyer may still anchor the unboxing photo, or 0 when never. */
export function unboxingDeadline(trade: EscrowTrade): number {
  if (trade.unboxingMediaCid) return 0;
  if (trade.state === TradeState.DISPUTED) return trade.unboxingUntil;
  if (trade.state === TradeState.COMPLETED && !trade.wasDisputed && trade.deliveredAt) {
    return trade.deliveredAt + getEscrowTimings(DEFAULT_NETWORK).unboxingWindowSeconds;
  }
  return 0;
}

/**
 * Escrow set_unboxing_media for the buyer. On a disputed trade the photo is
 * the evidence the jury reads for damage and mismatch claims; on a trade
 * completed without a dispute it only feeds reputation.
 */
export default function SetUnboxingMediaButton({ trade, disabled, activeMethod }: SetUnboxingMediaButtonProps) {
  const { address, status } = useWalletStore();
  const { setUnboxingMedia, pending } = useSetUnboxingMedia();
  const [open, setOpen] = useState(false);
  const [cid, setCid] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const deadline = unboxingDeadline(trade);
  const { remainingSeconds, isReady: closed } = useCountdown(deadline, 0);
  const isBuyer = status === "connected" && sameAddress(address, trade.buyer);

  if (!isBuyer || !deadline || closed) return null;

  const disputed = trade.state === TradeState.DISPUTED;
  const explorerLink = `${NETWORKS[DEFAULT_NETWORK].explorerUrl}/tx/${submittedHash ?? ""}`;

  const handleSubmit = async () => {
    if (!cid) return;
    setErrorMsg(null);
    try {
      setSubmittedHash(await setUnboxingMedia(trade.id, cid));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClose = () => {
    if (pending) return;
    setOpen(false);
    setCid(null);
    setSubmittedHash(null);
    setErrorMsg(null);
  };

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={handleClose}>
      <div
        className="w-full max-w-md rounded-xl bg-[var(--bg-deep)] border border-[var(--border-subtle)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-medium text-[var(--text-primary)]">Add unboxing photo to #{trade.id}</h2>
          <button onClick={handleClose} disabled={pending} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
            <X size={20} />
          </button>
        </div>
        {submittedHash ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Photo submitted. It counts once the transaction is final.
            </p>
            <a href={explorerLink} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] text-center text-[var(--text-primary)] font-medium hover:bg-[var(--bg-elevated)]">
              Open in explorer
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              {disputed
                ? "The jury reads this photo for damaged and not as described claims. It can be set once."
                : "This trade closed without a dispute, so the photo moves no money; it only feeds reputation. It can be set once."}
            </p>
            <MediaUpload
              label="Unboxing photo"
              hint="What you found when you opened the parcel."
              cid={cid}
              onCid={setCid}
              onBusyChange={setPhotoBusy}
              disabled={pending}
            />
            {errorMsg ? (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">{errorMsg}</div>
            ) : null}
            <button
              onClick={() => void handleSubmit()}
              disabled={!cid || photoBusy || pending}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {pending ? "Submitting..." : "Anchor photo"}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="w-full px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] bg-transparent text-[var(--text-primary)] font-medium hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {disabled && activeMethod === METHOD
          ? "Processing..."
          : `Add unboxing photo (${formatRemaining(remainingSeconds)} left)`}
      </button>
      {open && typeof window !== "undefined" ? createPortal(modal, document.body) : null}
    </div>
  );
}
