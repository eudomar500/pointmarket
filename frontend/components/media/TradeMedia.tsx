"use client";

import { ExternalLink, ImageOff } from "lucide-react";
import { ipfsUrl } from "@/lib/media/cid";
import type { EscrowTrade } from "@/lib/genlayer/types";
import PlainImg from "./PlainImg";

interface Slot {
  key: string;
  title: string;
  by: string;
  cid: string;
}

function slots(trade: EscrowTrade): Slot[] {
  const list: Slot[] = [
    { key: "listing", title: "Listing photo", by: "Seller, at listing", cid: trade.listingMediaCid },
    { key: "packing", title: "Packing photo", by: "Seller, at shipping", cid: trade.packingMediaCid },
    { key: "unboxing", title: "Unboxing photo", by: "Buyer, at delivery", cid: trade.unboxingMediaCid },
  ];
  if (trade.sellerResponseCid) {
    list.push({
      key: "response",
      title: "Seller response photo",
      by: "Seller, after the dispute opened (not read by the jury)",
      cid: trade.sellerResponseCid,
    });
  }
  return list;
}

/**
 * Listing, packing and unboxing photos, loaded from ipfs.filebase.io: the
 * gateway the jury reads, so what is shown here is what it judges.
 */
export default function TradeMedia({ trade }: { trade: EscrowTrade }) {
  return (
    <div className="p-6 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-1">Photos</div>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Anchored by CID on chain and served from ipfs.filebase.io, the same bytes the jury reads.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {slots(trade).map((slot) => (
          <figure key={slot.key} className="flex flex-col gap-2">
            <div className="aspect-square rounded-lg overflow-hidden bg-[var(--bg-deep)] border border-[var(--border-subtle)] flex items-center justify-center">
              {slot.cid ? (
                <a href={ipfsUrl(slot.cid)} target="_blank" rel="noopener noreferrer" className="w-full h-full">
                  <PlainImg src={ipfsUrl(slot.cid)} alt={slot.title} className="w-full h-full object-contain" />
                </a>
              ) : (
                <div className="flex flex-col items-center gap-2 text-xs text-[var(--text-tertiary)]">
                  <ImageOff size={18} />
                  No photo anchored
                </div>
              )}
            </div>
            <figcaption className="text-xs">
              <div className="text-[var(--text-primary)] font-medium">{slot.title}</div>
              <div className="text-[var(--text-secondary)]">{slot.by}</div>
              {slot.cid ? (
                <a
                  href={ipfsUrl(slot.cid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={slot.cid}
                  className="inline-flex items-center gap-1 font-mono text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  {slot.cid.slice(0, 12)}...{slot.cid.slice(-6)} <ExternalLink size={11} />
                </a>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
