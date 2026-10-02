"use client";

import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { TradeState } from "@/lib/genlayer/types";
import { truncateAddress } from "@/lib/wallet/format";

/**
 * The fields the timeline needs, shared by v1.5 trades and read-only
 * legacy trades. `verdictTitle` names who decided a dispute that paid out
 * ("Arbiter", or the legacy in-contract verdict); `verdictDetail` is shown
 * under it.
 */
export interface TimelineTrade {
  state: number;
  seller: string;
  buyer: string;
  wasDisputed: boolean;
  resolvedByDefault: boolean;
  buyerWins: boolean;
  deliveryProof?: boolean;
  verdictTitle?: string;
  verdictDetail?: string;
}

export default function TradeTimeline({ trade }: { trade: TimelineTrade }) {
  const steps = buildSteps(trade);

  return (
    <div className="relative">
      {steps.map((step, idx) => (
        <div key={idx} className="relative flex gap-4 pb-6 last:pb-0">
          {/* Vertical line connecting nodes */}
          {idx < steps.length - 1 && (
            <div
              className={`absolute left-3 top-7 w-px h-full ${step.reached ? "bg-[var(--accent-primary)]/50" : "bg-[var(--border-subtle)]"}`}
            />
          )}

          {/* Node icon */}
          <div className="relative z-10 flex-shrink-0">
            {step.icon}
          </div>

          {/* Step content */}
          <div className="flex-1 pb-2">
            <div className={`text-sm font-medium ${step.reached ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
              {step.title}
            </div>
            {step.detail && (
              <div className="text-xs text-[var(--text-secondary)] mt-1">
                {step.detail}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildSteps(trade: TimelineTrade) {
  const reached = (minState: number) => trade.state >= minState && trade.state !== TradeState.CANCELLED && trade.state !== TradeState.REFUNDED;
  const isCancelled = trade.state === TradeState.CANCELLED;
  const isRefunded = trade.state === TradeState.REFUNDED;

  const filledIcon = (
    <div className="w-6 h-6 rounded-full bg-[var(--accent-primary)] flex items-center justify-center">
      <CheckCircle size={14} className="text-[var(--bg-deep)]" />
    </div>
  );

  const emptyIcon = (
    <div className="w-6 h-6 rounded-full border-2 border-[var(--border-subtle)]" />
  );

  const warningIcon = (
    <div className="w-6 h-6 rounded-full bg-[var(--warning)] flex items-center justify-center">
      <AlertTriangle size={14} className="text-[var(--bg-deep)]" />
    </div>
  );

  const cancelIcon = (
    <div className="w-6 h-6 rounded-full bg-[var(--text-tertiary)] flex items-center justify-center">
      <XCircle size={14} className="text-[var(--bg-deep)]" />
    </div>
  );

  const skippedIcon = cancelIcon;

  if (isCancelled) {
    return [
      {
        title: "Listing created",
        detail: `By ${truncateAddress(trade.seller)}`,
        reached: true,
        icon: filledIcon,
      },
      {
        title: "Listing cancelled",
        detail: "Seller cancelled before any buyer accepted",
        reached: true,
        icon: cancelIcon,
      },
    ];
  }

  const isCompleted = trade.state === TradeState.COMPLETED;
  const isStuckDispute = isRefunded && trade.wasDisputed;
  const isUnshippedRefund = isRefunded && !trade.wasDisputed;
  const isDisputedPayout = isCompleted && trade.wasDisputed;
  const hasBuyer = Boolean(trade.buyer) && trade.buyer.toLowerCase() !== trade.seller.toLowerCase();

  const steps = [
    {
      title: "Listing created",
      detail: `By ${truncateAddress(trade.seller)}`,
      reached: true,
      icon: filledIcon,
    },
    {
      title: "Listing accepted",
      detail: (reached(TradeState.PAID) || isRefunded) && hasBuyer
        ? `By ${truncateAddress(trade.buyer)}`
        : undefined,
      reached: reached(TradeState.PAID) || isRefunded,
      icon: (reached(TradeState.PAID) || isRefunded) ? filledIcon : emptyIcon,
    },
    {
      title: "Shipped",
      // A stuck dispute is only reachable from DISPUTED, so the item was shipped.
      detail: reached(TradeState.SHIPPED) || isStuckDispute
        ? trade.deliveryProof
          ? "Tracking provided by seller; delivery proof accepted"
          : "Tracking provided by seller"
        : (isUnshippedRefund ? "Not shipped within window" : undefined),
      reached: reached(TradeState.SHIPPED) || isRefunded,
      icon: reached(TradeState.SHIPPED) || isStuckDispute
        ? filledIcon
        : (isUnshippedRefund ? skippedIcon : emptyIcon),
    },
  ];

  if (trade.wasDisputed || trade.state === TradeState.DISPUTED) {
    steps.push({
      title: "Dispute opened",
      detail: trade.state === TradeState.DISPUTED ? "Awaiting response or resolve" : undefined,
      reached: true,
      icon: warningIcon,
    });
  }

  // How the dispute was settled. It comes before the payout step so the cause of
  // the outcome is never shown after the outcome itself.
  if (isDisputedPayout) {
    steps.push({
      title: trade.resolvedByDefault
        ? "Dispute resolved by default"
        : `Dispute resolved by ${trade.verdictTitle ?? "the Arbiter"}`,
      detail: trade.resolvedByDefault
        ? "Seller did not respond within the window"
        : trade.verdictDetail,
      reached: true,
      icon: filledIcon,
    });
  }

  // Terminal payout step. It follows the dispute steps when a dispute happened,
  // so the outcome is never shown before the dispute that produced it.
  let outcomeTitle = "Delivered & paid out";
  let outcomeDetail: string | undefined = undefined;
  let outcomeIcon = emptyIcon;
  if (isDisputedPayout) {
    outcomeTitle = "Paid out";
    outcomeDetail = trade.buyerWins
      ? "Funds returned to buyer"
      : "Funds released to seller";
    outcomeIcon = filledIcon;
  } else if (isCompleted) {
    outcomeDetail = "Funds released to seller";
    outcomeIcon = filledIcon;
  } else if (isStuckDispute) {
    outcomeTitle = "Dispute closed without verdict";
    outcomeDetail = "Funds split between buyer and seller";
    outcomeIcon = filledIcon;
  } else if (isUnshippedRefund) {
    outcomeIcon = skippedIcon;
  }
  steps.push({
    title: outcomeTitle,
    detail: outcomeDetail,
    reached: isCompleted || isStuckDispute,
    icon: outcomeIcon,
  });

  if (isUnshippedRefund) {
    // Buyer claimed a refund because the seller never shipped.
    steps.push({
      title: "Refunded",
      detail: "Funds returned to buyer",
      reached: true,
      icon: filledIcon,
    });
  }

  return steps;
}
