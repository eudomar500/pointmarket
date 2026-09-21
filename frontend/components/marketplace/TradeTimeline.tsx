"use client";

import { CheckCircle, Circle, AlertTriangle, XCircle } from "lucide-react";
import { TradeState } from "@/lib/genlayer/types";
import { truncateAddress } from "@/lib/wallet/format";

interface TradeTimelineProps {
  trade: {
    state: number;
    seller: string;
    buyer: string;
    shipped_at: number;
    disputed: boolean;
    disputed_at?: number;
    dispute_initiator?: string;
    resolved_by_default?: boolean;
    llm_verdict_buyer_wins?: boolean;
    llm_verdict_reasoning?: string;
  };
}

export default function TradeTimeline({ trade }: TradeTimelineProps) {
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

function buildSteps(trade: TradeTimelineProps["trade"]) {
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
  
  const isCompleted = trade.state === TradeState.COMPLETED;
  const isStuckDispute = isRefunded && trade.disputed;
  const isUnshippedRefund = isRefunded && !trade.disputed;
  const isDisputedPayout = isCompleted && trade.disputed;

  const steps = [
    {
      title: "Listing created",
      detail: `By ${truncateAddress(trade.seller)}`,
      reached: true,
      icon: filledIcon,
    },
    {
      title: "Listing accepted",
      detail: (reached(TradeState.PAID) || isRefunded) && trade.buyer && trade.buyer !== trade.seller 
        ? `By ${truncateAddress(trade.buyer)}` 
        : undefined,
      reached: reached(TradeState.PAID) || isRefunded,
      icon: (reached(TradeState.PAID) || isRefunded) ? filledIcon : emptyIcon,
    },
    {
      title: "Shipped",
      // A stuck dispute is only reachable from DISPUTED, so the item was shipped.
      detail: reached(TradeState.SHIPPED) || isStuckDispute
        ? `Tracking provided by seller` 
        : (isUnshippedRefund ? "Not shipped within window" : undefined),
      reached: reached(TradeState.SHIPPED) || isRefunded,
      icon: reached(TradeState.SHIPPED) || isStuckDispute
        ? filledIcon 
        : (isUnshippedRefund ? skippedIcon : emptyIcon),
    },
  ];
  
  // Dispute lifecycle steps
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const initiatorSet =
    trade.dispute_initiator &&
    trade.dispute_initiator.toLowerCase() !== ZERO_ADDRESS;
  const initiatorIsBuyer =
    initiatorSet && trade.dispute_initiator!.toLowerCase() === trade.buyer.toLowerCase();
  const initiatorLabel = initiatorIsBuyer ? "buyer" : "seller";
  const isDisputeActive = trade.state === TradeState.DISPUTED;

  if (trade.disputed || isDisputeActive) {
    const detail = initiatorSet
      ? `Initiated by ${initiatorLabel}`
      : "Awaiting LLM resolution";
    steps.push({
      title: "Dispute opened",
      detail,
      reached: true,
      icon: warningIcon,
    });
  }

  // How the dispute was settled. It comes before the payout step so the cause of
  // the outcome is never shown after the outcome itself.
  if (isDisputedPayout) {
    const resolvedByDefault = Boolean(trade.resolved_by_default);
    steps.push({
      title: resolvedByDefault ? "Dispute resolved by default" : "Dispute resolved by LLM",
      detail: resolvedByDefault
        ? "Other party did not respond within the window"
        : trade.llm_verdict_reasoning || undefined,
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
    outcomeDetail = trade.llm_verdict_buyer_wins
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
