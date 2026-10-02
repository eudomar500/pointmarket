"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, MailCheck } from "lucide-react";
import { useWalletStore } from "@/lib/wallet/store";
import { useLacreRecord, type LacreLookup } from "@/lib/hooks/useLacreRecord";
import { useSubmitDeliveryProof } from "@/lib/hooks/useSubmitDeliveryProof";
import { sameAddress } from "@/lib/genlayer/escrow";
import { DEFAULT_NETWORK } from "@/lib/genlayer/contracts";
import { NETWORKS } from "@/config/networks";
import { formatDateTime } from "@/lib/utils/time";
import { truncateAddress } from "@/lib/wallet/format";
import { TradeState, type EscrowTrade } from "@/lib/genlayer/types";

const LACRE_URL = "https://lacre.in-sidr.xyz";
/** Escrow.MIN_KEY_BITS. */
const MIN_KEY_BITS = 1024;

interface DeliveryProofBlockProps {
  trade: EscrowTrade;
  disabled?: boolean;
}

/**
 * Optional Lacre delivery proof. The seller attests the carrier's signed
 * email with their wallet on Lacre and pastes the record id here; the
 * Escrow accepts it only from LATEST_FINAL and only when it matches the
 * trade. Once accepted, the claim window can close sooner and a bare "not
 * received" claim loses by rule.
 */
export default function DeliveryProofBlock({ trade, disabled }: DeliveryProofBlockProps) {
  const { address, status } = useWalletStore();
  const shippedOrLater = trade.shippedAt > 0;
  if (!shippedOrLater) return null;

  const isSeller = status === "connected" && sameAddress(address, trade.seller);
  const canSubmit =
    isSeller &&
    !trade.deliveryProof &&
    (trade.state === TradeState.SHIPPED || trade.state === TradeState.DISPUTED);

  if (!trade.deliveryProof && !canSubmit) {
    return null;
  }

  return (
    <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MailCheck size={16} className="text-[var(--text-secondary)]" />
          <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Delivery proof</div>
        </div>
        <Link
          href="/#lacre"
          title="How delivery proof works"
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-deep)] text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition-colors"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]" />
          Powered by Lacre
        </Link>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        A delivery proof shows the carrier&apos;s system emailed the seller after payment. It does not
        show that the parcel was delivered, or what was in it.
      </p>

      {trade.deliveryProof ? (
        <AcceptedProof trade={trade} />
      ) : (
        <SubmitProof trade={trade} disabled={disabled} />
      )}
    </div>
  );
}

function AcceptedProof({ trade }: { trade: EscrowTrade }) {
  const { data, isLoading, error } = useLacreRecord(trade.deliveryProof);
  return (
    <div className="space-y-3">
      <div className="text-sm text-[var(--text-primary)]">
        Record <span className="font-mono">#{trade.deliveryProof}</span> accepted{" "}
        {formatDateTime(trade.proofAt)}. The seller can claim from {formatDateTime(trade.claimAt)}.
      </div>
      {isLoading ? <Reading /> : null}
      {error ? <p className="text-xs text-red-400">Could not read the record from Lacre.</p> : null}
      {data ? <RecordView lookup={data} /> : null}
    </div>
  );
}

function SubmitProof({ trade, disabled }: { trade: EscrowTrade; disabled?: boolean }) {
  const [recordId, setRecordId] = useState("");
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { submitDeliveryProof, pending } = useSubmitDeliveryProof();
  const id = recordId.trim();
  const { data, isLoading } = useLacreRecord(id);
  const domains = trade.carrierDomains ? trade.carrierDomains.split(",") : [];

  const problem = (() => {
    if (domains.length === 0) {
      return "This trade was shipped without carrier domains, so no proof can be accepted for it.";
    }
    if (!id) return "Paste the record id from Lacre.";
    if (!/^\d+$/.test(id)) return "A record id is a number.";
    if (isLoading || !data) return "Reading the record...";
    if (!data.verifier) return "The Lacre Router names no Verifier right now.";
    if (!data.record) return "No record with this id on the current Verifier.";
    if (!data.final)
      return "This record is not final yet (Lacre records take about 35 minutes). The Escrow only accepts final records.";
    const r = data.record;
    if (!r.valid) return `The record is not valid (${r.reason || "no reason given"}).`;
    if (!r.aligned) return "The record's From domain is not aligned with its signer.";
    if (!domains.includes(r.domain)) return `Signed by ${r.domain}, which is not one of this trade's carrier domains.`;
    if (Number(r.key_bits) < MIN_KEY_BITS) return `The signing key has ${r.key_bits} bits; at least ${MIN_KEY_BITS} are required.`;
    if (Number(r.signed_at) <= trade.paidAt) return "The email was signed before the buyer paid, so it cannot be about this shipment.";
    return null;
  })();

  const handleSubmit = async () => {
    setErrorMsg(null);
    try {
      setSubmittedHash(await submitDeliveryProof(trade.id, id));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const explorer = NETWORKS[DEFAULT_NETWORK].explorerUrl;

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--text-secondary)]">
        Attest the carrier&apos;s shipping email with your wallet on{" "}
        <a href={LACRE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline">
          lacre.in-sidr.xyz <ExternalLink size={12} />
        </a>
        , wait for the record to finalize, then paste its id. Accepted domains for this trade:{" "}
        <span className="font-mono">{domains.length ? domains.join(", ") : "none"}</span>.
      </p>
      <input
        type="text"
        inputMode="numeric"
        value={recordId}
        onChange={(e) => setRecordId(e.target.value)}
        disabled={pending || disabled || Boolean(submittedHash)}
        placeholder="Lacre record id, e.g. 12"
        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-deep)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-50"
      />
      {data?.record ? <RecordView lookup={data} /> : null}
      {submittedHash ? (
        <p className="text-sm text-[var(--text-secondary)]">
          Proof submitted.{" "}
          <a href={`${explorer}/tx/${submittedHash}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-primary)] hover:underline">
            Open in explorer
          </a>
        </p>
      ) : (
        <>
          <button
            onClick={() => void handleSubmit()}
            disabled={problem !== null || pending || disabled}
            className="w-full px-4 py-2.5 rounded-lg bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium hover:bg-[var(--accent-dim)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? "Submitting..." : "Submit delivery proof"}
          </button>
          {problem ? <p className="text-xs text-[var(--text-secondary)]">{problem}</p> : null}
        </>
      )}
      {errorMsg ? (
        <div className="p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-400">{errorMsg}</div>
      ) : null}
    </div>
  );
}

function RecordView({ lookup }: { lookup: LacreLookup }) {
  const r = lookup.record;
  if (!r) return null;
  const explorer = NETWORKS[DEFAULT_NETWORK].explorerUrl;
  const rows: [string, string][] = [
    ["Domain", r.domain],
    ["Selector", r.selector],
    ["Key bits", r.key_bits],
    ["Signed at", formatDateTime(Number(r.signed_at))],
    ["Valid", r.valid ? "Yes" : `No (${r.reason})`],
    ["Aligned", r.aligned ? "Yes" : "No"],
    ["Requester", truncateAddress(r.requester)],
  ];
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-deep)] border border-[var(--border-subtle)] text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-secondary)]">
          Lacre record #{r.id} {lookup.final ? "(final)" : "(provisional, not final yet)"}
        </span>
        {lookup.verifier ? (
          <a
            href={`${explorer}/address/${lookup.verifier}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--accent-primary)] hover:underline"
          >
            Verifier <ExternalLink size={11} />
          </a>
        ) : null}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-[var(--text-secondary)]">{k}</span>
          <span className="font-mono text-[var(--text-primary)] text-right break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Reading() {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
      <Loader2 size={12} className="animate-spin" /> Reading the record from Lacre...
    </div>
  );
}
