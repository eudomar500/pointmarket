"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatGenBalance } from "@/lib/wallet/format";
import { NETWORKS } from "@/config/networks";
import { DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { STATEMENT_MAX } from "@/lib/genlayer/escrow";
import { codePoints } from "@/lib/genlayer/precheck";
import { ClaimKind, CLAIM_KIND_LABELS, type ClaimKindValue } from "@/lib/genlayer/types";
import MediaUpload from "@/components/media/MediaUpload";

const MIN_STATEMENT_LENGTH = 1;

export interface DisputeSubmission {
  claimKind: number;
  statement: string;
  cid: string;
}

interface DisputeEvidenceDialogProps {
  mode: "open" | "respond";
  tradeId: number;
  title: string;
  price: bigint;
  bond: bigint;
  onClose: () => void;
  onSubmit: (submission: DisputeSubmission) => Promise<string>;
}

const CLAIM_HELP: Record<ClaimKindValue, string> = {
  [ClaimKind.NOT_RECEIVED]:
    "The parcel never arrived. Loses by rule if the seller has an accepted delivery proof; otherwise the jury checks the seller's packing photo.",
  [ClaimKind.DAMAGED]:
    "It arrived broken. You need an unboxing photo; the jury checks it for damage.",
  [ClaimKind.NOT_AS_DESCRIBED]:
    "It is not the item in the listing. You need an unboxing photo; the jury checks it against the listing.",
};

export default function DisputeEvidenceDialog({
  mode,
  tradeId,
  title,
  price,
  bond,
  onClose,
  onSubmit,
}: DisputeEvidenceDialogProps) {
  const [claimKind, setClaimKind] = useState<number>(0);
  const [statement, setStatement] = useState("");
  const [cid, setCid] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const statementLength = codePoints(statement);
  const statementValid =
    statementLength >= MIN_STATEMENT_LENGTH && statementLength <= STATEMENT_MAX;
  const kindValid = mode === "respond" || claimKind !== 0;
  const needsUnboxing =
    mode === "open" && (claimKind === ClaimKind.DAMAGED || claimKind === ClaimKind.NOT_AS_DESCRIBED);
  const canSubmit = statementValid && kindValid && !photoBusy && !submitting;

  const explorerBase = NETWORKS[DEFAULT_NETWORK].explorerUrl;
  const explorerLink = explorerBase + "/tx/" + (submittedHash ?? "");

  const headerText =
    mode === "open" ? `Open dispute on #${tradeId}?` : `Respond to dispute on #${tradeId}?`;

  const bondLabel = mode === "open" ? "Buyer bond (fixed)" : "Seller bond (5%)";

  const explainerText =
    mode === "open"
      ? "Opening a dispute holds the funds and starts the seller's response window. Once the seller responds, or the window closes, anyone can ask the Arbiter to resolve it. The burden rules decide first; when they do not, a jury of validators checks one photo. The loser's bond goes to the winner."
      : "Your response and bond are recorded on the Escrow. Nothing is decided by this transaction: once it is final, anyone can press Resolve and the Arbiter applies the burden rules or asks the jury to check the photos. The loser's bond goes to the winner.";

  const placeholderText =
    mode === "open"
      ? "Example: The listing showed a desk lamp. The box contained a printed logo, see the unboxing photo. I opened the parcel on camera the day it arrived."
      : "Example: I packed the lamp shown in the listing photo, see the packing photo taken before sealing the box.";

  const submitLabel = mode === "open" ? "Post bond and open dispute" : "Post bond and respond";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const hash = await onSubmit({ claimKind, statement, cid: cid ?? "" });
      setSubmittedHash(hash);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const dialogContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-[var(--bg-deep)] border border-[var(--border-subtle)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-medium text-[var(--text-primary)]">{headerText}</h2>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {submittedHash ? (
          <div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {mode === "open"
                ? "Dispute submitted. Track its progress in the drawer at the bottom right. Once it is final, the seller has the response window to answer."
                : "Response submitted. Once it is final (about 35 minutes), anyone can press Resolve on this page."}
            </p>
            <div className="mb-6 p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-secondary)] break-all">
              {submittedHash}
            </div>
            <div className="flex gap-3">
              <a
                href={explorerLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-elevated)] transition-colors text-center"
              >
                Open in explorer
              </a>
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4 p-4 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                Trade #{tradeId}
              </div>
              <div className="text-base text-[var(--text-primary)] mb-3 break-words">{title}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Trade price
                  </div>
                  <div className="text-sm font-medium text-[var(--text-primary)] font-mono">
                    {formatGenBalance(price)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {bondLabel}
                  </div>
                  <div className="text-sm font-medium text-[var(--text-primary)] font-mono">
                    {formatGenBalance(bond)}
                  </div>
                </div>
              </div>
            </div>

            <p className="text-sm text-[var(--text-secondary)] mb-4">{explainerText}</p>

            {mode === "open" ? (
              <div className="mb-4">
                <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                  What went wrong
                </div>
                <div className="flex flex-col gap-2">
                  {(Object.values(ClaimKind) as ClaimKindValue[]).map((kind) => (
                    <label
                      key={kind}
                      className={`flex gap-3 p-3 rounded-lg border cursor-pointer ${claimKind === kind ? "border-[var(--accent-primary)]" : "border-[var(--border-subtle)]"}`}
                    >
                      <input
                        type="radio"
                        name="claim-kind"
                        checked={claimKind === kind}
                        disabled={submitting}
                        onChange={() => setClaimKind(kind)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm text-[var(--text-primary)]">
                          {CLAIM_KIND_LABELS[kind]}
                        </span>
                        <span className="block text-xs text-[var(--text-secondary)]">
                          {CLAIM_HELP[kind]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mb-4">
              <label className="text-xs uppercase tracking-wider text-[var(--text-secondary)] block mb-2">
                Your statement (public)
              </label>
              <textarea
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                disabled={submitting}
                placeholder={placeholderText}
                rows={6}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent-primary)] resize-y font-sans disabled:opacity-50"
              />
              <div className="flex justify-between items-center mt-1">
                <span className="text-xs text-[var(--text-secondary)]">
                  {statementLength === 0
                    ? `Required: ${MIN_STATEMENT_LENGTH}-${STATEMENT_MAX} chars`
                    : `${statementLength} / ${STATEMENT_MAX} chars`}
                </span>
                {statementLength > STATEMENT_MAX ? (
                  <span className="text-xs text-red-400">Too long</span>
                ) : null}
              </div>
            </div>

            <div className="mb-4">
              {mode === "open" ? (
                <MediaUpload
                  label={needsUnboxing ? "Unboxing photo (needed for this claim)" : "Unboxing photo (optional)"}
                  hint={
                    needsUnboxing
                      ? "What you found in the box. You can also add it later from the trade page, until the unboxing window closes; without it this claim loses by rule."
                      : "What you found in the box, if anything."
                  }
                  cid={cid}
                  onCid={setCid}
                  onBusyChange={setPhotoBusy}
                  disabled={submitting}
                />
              ) : (
                <MediaUpload
                  label="Response photo (optional)"
                  hint="Shown on the trade page next to your statement. It was taken after the dispute opened, so the jury does not read it and it cannot replace a packing photo."
                  cid={cid}
                  onCid={setCid}
                  onBusyChange={setPhotoBusy}
                  disabled={submitting}
                />
              )}
            </div>

            <p className="text-xs text-[var(--text-secondary)] mb-4">
              On Bradbury a payable call that fails keeps its value. Right before your wallet
              opens, the trade is read again on chain; if the state, your role, the window or the
              bond amount do not hold, nothing is sent.
            </p>

            {errorMsg ? (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                {errorMsg}
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-primary)] font-medium hover:bg-[var(--bg-elevated)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50"
              >
                {submitting ? "Checking and submitting..." : submitLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof window === "undefined") return null;
  return createPortal(dialogContent, document.body);
}
