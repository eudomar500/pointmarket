"use client";
import { useMemo } from "react";
import { useWalletStore } from "@/lib/wallet/store";
import { useTxStore } from "@/lib/tx/store";
import { defaultJudgmentBlocked, sameAddress } from "@/lib/genlayer/escrow";
import CancelListingButton from "./CancelListingButton";
import AcceptListingButton from "./AcceptListingButton";
import MarkShippedDialog from "./MarkShippedDialog";
import ConfirmDeliveryButton from "./ConfirmDeliveryButton";
import ClaimAfterWindowButton from "./ClaimAfterWindowButton";
import ClaimUnshippedRefundButton from "./ClaimUnshippedRefundButton";
import OpenDisputeButton from "./OpenDisputeButton";
import RespondToDisputeButton from "./RespondToDisputeButton";
import ClaimDisputeDefaultButton from "./ClaimDisputeDefaultButton";
import ForceRefundStuckDisputeButton from "./ForceRefundStuckDisputeButton";
import ClaimStuckDisputeRefundButton from "./ClaimStuckDisputeRefundButton";
import SetUnboxingMediaButton, { unboxingDeadline } from "./SetUnboxingMediaButton";
import type { EscrowTrade } from "@/lib/genlayer/types";

interface TradeActionsPanelProps {
  trade: EscrowTrade;
}

/**
 * Aggregates write actions available on a trade for the connected
 * wallet. Each child button still decides whether to render itself,
 * but this wrapper checks the same conditions upfront so the panel
 * collapses to null when no action is applicable.
 *
 * The panel also subscribes to the TX store for any in-flight write
 * targeting this trade. While such a TX exists (submitted or accepted
 * but not yet finalized), every action button is rendered in a busy
 * state. The on-chain state has not changed yet during the Finality
 * Window, so without this guard a user could double-submit the same
 * action and burn gas on a transaction that will revert.
 *
 * Resolve is not here: anyone may press it, so it lives in the dispute
 * block for every visitor.
 */
export default function TradeActionsPanel({ trade }: TradeActionsPanelProps) {
  const { address, status } = useWalletStore();
  const context = `Trade #${trade.id}`;
  const allTxs = useTxStore((s) => s.txs);
  const { hasActiveTx, activeMethod } = useMemo(() => {
    const active = allTxs.filter(
      (t) =>
        t.context === context &&
        t.uiState !== "finalized" &&
        t.uiState !== "failed",
    );
    // The label belongs to the newest write on this trade, so sort by
    // submission time descending rather than trusting array order.
    const newest = [...active].sort((a, b) => b.submittedAt - a.submittedAt)[0];
    return {
      hasActiveTx: active.length > 0,
      activeMethod: newest ? newest.method : null,
    };
  }, [allTxs, context]);

  const connected = status === "connected" && address;
  if (!connected) return null;

  const isSeller = sameAddress(address, trade.seller);
  const isBuyer = sameAddress(address, trade.buyer) && !isSeller;
  const isOpen = trade.state === 0;
  const isPaid = trade.state === 1;
  const isShipped = trade.state === 2;
  const isDisputed = trade.state === 3;

  const hasAnyAction =
    (isSeller && (isOpen || isPaid || isShipped)) ||
    (!isSeller && isOpen) ||
    (isBuyer && (isPaid || isShipped)) ||
    (isBuyer && unboxingDeadline(trade) > 0) ||
    isDisputed;
  if (!hasAnyAction) return null;

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-4">
        Actions
      </div>
      <div className="flex flex-col gap-3">
        <AcceptListingButton
          tradeId={trade.id}
          seller={trade.seller}
          state={trade.state}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <MarkShippedDialog
          tradeId={trade.id}
          seller={trade.seller}
          state={trade.state}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <ConfirmDeliveryButton
          tradeId={trade.id}
          buyer={trade.buyer}
          state={trade.state}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <ClaimAfterWindowButton
          tradeId={trade.id}
          seller={trade.seller}
          state={trade.state}
          claimAt={trade.claimAt}
          price={trade.price}
          feeAmount={trade.feeAmount}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <ClaimUnshippedRefundButton
          tradeId={trade.id}
          buyer={trade.buyer}
          state={trade.state}
          paidAt={trade.paidAt}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <OpenDisputeButton
          tradeId={trade.id}
          buyer={trade.buyer}
          state={trade.state}
          claimAt={trade.claimAt}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <SetUnboxingMediaButton trade={trade} disabled={hasActiveTx} activeMethod={activeMethod} />
        <RespondToDisputeButton
          tradeId={trade.id}
          seller={trade.seller}
          state={trade.state}
          responded={trade.responded}
          responseUntil={trade.responseUntil}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <ClaimDisputeDefaultButton
          tradeId={trade.id}
          buyer={trade.buyer}
          state={trade.state}
          responded={trade.responded}
          responseUntil={trade.responseUntil}
          buyerBond={trade.buyerBond}
          burdenBlocked={defaultJudgmentBlocked(trade)}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <ForceRefundStuckDisputeButton
          tradeId={trade.id}
          state={trade.state}
          disputedAt={trade.disputedAt}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <ClaimStuckDisputeRefundButton
          tradeId={trade.id}
          state={trade.state}
          disputedAt={trade.disputedAt}
          price={trade.price}
          title={trade.title}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
        <CancelListingButton
          tradeId={trade.id}
          seller={trade.seller}
          state={trade.state}
          disabled={hasActiveTx}
          activeMethod={activeMethod}
        />
      </div>
    </div>
  );
}
