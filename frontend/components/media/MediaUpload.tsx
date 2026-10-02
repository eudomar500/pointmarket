"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus, Loader2, X } from "lucide-react";
import { prepareImage, type PreparedImage } from "@/lib/media/reencode";
import { pinImage } from "@/lib/media/pin";
import { ipfsUrl } from "@/lib/media/cid";
import PlainImg from "./PlainImg";

interface MediaUploadProps {
  label: string;
  /** One line on what this photo should show. */
  hint?: string;
  cid: string | null;
  onCid: (cid: string | null) => void;
  disabled?: boolean;
  /** Reported up so the parent can block submit while a photo is pending. */
  onBusyChange?: (busy: boolean) => void;
}

type Phase = "idle" | "preparing" | "ready" | "pinning" | "pinned";

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * Picks a photo, re-encodes it in the browser and pins it on explicit
 * request. Nothing leaves the browser before the user presses "Pin photo",
 * and the public-evidence notice is shown above the picker from the start.
 */
export default function MediaUpload({
  label,
  hint,
  cid,
  onCid,
  disabled,
  onBusyChange,
}: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(cid ? "pinned" : "idle");
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange?.(phase === "preparing" || phase === "ready" || phase === "pinning");
  }, [phase, onBusyChange]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const reset = () => {
    setPrepared(null);
    setPreviewUrl(null);
    setError(null);
    setPhase("idle");
    onCid(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPhase("preparing");
    try {
      const img = await prepareImage(file);
      setPrepared(img);
      setPreviewUrl(URL.createObjectURL(img.blob));
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  };

  const handlePin = async () => {
    if (!prepared) return;
    setError(null);
    setPhase("pinning");
    try {
      const pinned = await pinImage(prepared.bytes);
      onCid(pinned);
      setPhase("pinned");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("ready");
    }
  };

  const busy = phase === "preparing" || phase === "pinning";

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">{label}</div>
      {hint ? <p className="text-xs text-[var(--text-secondary)]">{hint}</p> : null}
      <p className="text-xs text-[var(--warning)]">
        Photos are public. Anyone can open this image and its CID for as long as it stays pinned,
        and the CID is written on chain. Keep labels, addresses and faces out of frame.
      </p>

      {phase === "idle" || phase === "preparing" ? (
        <label
          className={`flex items-center justify-center gap-2 px-4 py-6 rounded-lg border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] ${disabled || busy ? "opacity-50" : "cursor-pointer hover:border-[var(--accent-primary)]"}`}
        >
          {phase === "preparing" ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Preparing photo...
            </>
          ) : (
            <>
              <ImagePlus size={16} /> Choose a photo
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
      ) : null}

      {(phase === "ready" || phase === "pinning" || phase === "pinned") && (previewUrl || cid) ? (
        <div className="flex gap-3 items-start p-3 rounded-lg bg-[var(--bg-deep)] border border-[var(--border-subtle)]">
          <div className="w-20 h-20 flex-shrink-0 rounded overflow-hidden bg-[var(--bg-elevated)]">
            <PlainImg
              src={previewUrl ?? ipfsUrl(cid as string)}
              alt={label}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0 text-xs text-[var(--text-secondary)] space-y-1">
            {prepared ? (
              <div>
                {prepared.width} x {prepared.height}, {formatKb(prepared.bytes.length)}, JPEG. Metadata
                and location removed.
              </div>
            ) : null}
            {phase === "pinned" && cid ? (
              <a
                href={ipfsUrl(cid)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[var(--accent-primary)] hover:underline break-all"
              >
                {cid.slice(0, 14)}...{cid.slice(-6)} <ExternalLink size={12} />
              </a>
            ) : null}
            <div className="flex gap-2 pt-1">
              {phase !== "pinned" ? (
                <button
                  type="button"
                  onClick={() => void handlePin()}
                  disabled={disabled || phase === "pinning"}
                  className="px-3 py-1.5 rounded-md bg-[var(--accent-primary)] text-[var(--bg-deep)] font-medium disabled:opacity-50"
                >
                  {phase === "pinning" ? "Pinning..." : "Pin photo"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={reset}
                disabled={disabled || phase === "pinning"}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-primary)] disabled:opacity-50"
              >
                <X size={12} /> {phase === "pinned" ? "Use another photo" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>
      ) : null}
    </div>
  );
}
