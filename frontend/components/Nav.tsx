"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Wordmark from "./brand/Wordmark";
import ThemeToggle from "./ThemeToggle";
import { useScrollDot } from "./brand/ScrollDotContext";
import { useWalletStore } from "../lib/wallet/store";
import AccountMenu from "./wallet/AccountMenu";
import ConnectWalletModal from "./wallet/ConnectWalletModal";
import { useState, useEffect } from "react";
import { DOCS_URL } from "../config/links";

/** Landing sections reachable from the nav. Always linked as "/#id" so they work from any route. */
const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "why-genlayer", label: "Why GenLayer" },
  { id: "lacre", label: "Delivery proof" },
];

export default function Nav() {
  const { activeSection, lenisInstance } = useScrollDot();
  const pathname = usePathname();
  const { status, initSilentReconnect } = useWalletStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const onLanding = pathname === "/";

  useEffect(() => {
    initSilentReconnect();
  }, [initSilentReconnect]);

  // On the landing page, scroll smoothly instead of navigating. Elsewhere the
  // Link goes to "/#id" and the browser lands on the section.
  const handleSectionClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string | null) => {
    if (!onLanding) return;
    e.preventDefault();
    const el = id ? document.getElementById(id) : null;
    if (lenisInstance) {
      lenisInstance.scrollTo(el ?? 0, { offset: el ? -80 : 0, duration: 1.2 });
    } else if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const linkClass = (id: string) =>
    `hover:text-[var(--text-primary)] transition-colors ${
      onLanding && activeSection === id ? "text-[var(--text-primary)]" : ""
    }`;

  return (
    <nav className="fixed top-0 left-0 right-0 h-16 bg-[var(--bg-deep)]/70 backdrop-blur-xl border-b border-[var(--border-subtle)] z-40">
      <div className="max-w-[1280px] mx-auto h-full px-6 flex items-center justify-between">
        {/* Left: Brand */}
        <div className="flex-shrink-0 flex items-center h-full pt-1">
          <Link href="/" onClick={(e) => handleSectionClick(e, null)} aria-label="Pointmarket home">
            <Wordmark size="md" />
          </Link>
        </div>

        {/* Right: Links & Actions */}
        <div className="flex items-center gap-6 h-full text-[14px] font-medium">
          {/* Group 1: Anchors */}
          <div className="hidden md:flex items-center gap-6 text-[var(--text-secondary)]">
            {SECTIONS.map((s) => (
              <Link
                key={s.id}
                href={`/#${s.id}`}
                onClick={(e) => handleSectionClick(e, s.id)}
                className={linkClass(s.id)}
              >
                {s.label}
              </Link>
            ))}
          </div>

          <div className="hidden md:block w-px h-4 bg-[var(--border-subtle)] mx-2" />

          {/* Group 2: Pages */}
          <div className="hidden lg:flex items-center gap-6 text-[var(--text-secondary)]">
            <Link href="/marketplace" className="text-[var(--text-primary)] font-semibold transition-colors">
              Marketplace
            </Link>
            <Link
              href="/#markets"
              onClick={(e) => handleSectionClick(e, "markets")}
              className={`${linkClass("markets")} inline-flex items-center gap-1.5`}
            >
              Markets
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Soon</span>
            </Link>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors"
            >
              Docs
            </a>
          </div>

          {/* Group 3: Actions */}
          <div className="flex items-center gap-4">
            {status === "connected" ? (
              <AccountMenu />
            ) : (
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="bg-[var(--accent-primary)] text-[var(--bg-deep)] px-4 py-2 rounded-md font-medium text-sm hover:bg-[var(--accent-dim)] transition-colors"
              >
                Connect Wallet
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </div>

      <ConnectWalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </nav>
  );
}
