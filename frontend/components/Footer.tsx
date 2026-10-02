import React from "react";
import Link from "next/link";
import Wordmark from "./brand/Wordmark";
import { DOCS_URL, GITHUB_URL, LACRE_APP_URL } from "../config/links";

export default function Footer() {
  return (
    <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-deep)]">
      <div className="max-w-[1280px] mx-auto px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 mb-16">
          {/* Col 1 */}
          <div className="flex flex-col items-start">
            <Wordmark size="sm" withSignature />
            <p className="mt-4 text-sm text-[var(--text-secondary)] max-w-xs">
              P2P marketplace with escrow. Disputes judged by GenLayer validators reading the photos. Prediction markets coming soon.
            </p>
          </div>

          {/* Col 2 */}
          <div className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-[var(--text-primary)] mb-1">Product</span>
            <Link href="/marketplace" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit">
              Marketplace
            </Link>
            <Link href="/#markets" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit">
              Markets <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">Soon</span>
            </Link>
          </div>

          {/* Col 3 */}
          <div className="flex flex-col gap-3 text-sm">
            <span className="font-medium text-[var(--text-primary)] mb-1">Resources</span>
            <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit">
              Docs
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit">
              GitHub
            </a>
            <a href={LACRE_APP_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit">
              Lacre
            </a>
            <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors w-fit">
              GenLayer
            </a>
          </div>
        </div>

        {/* Bottom row */}
        <div className="flex flex-col sm:flex-row items-center justify-between pt-8 border-t border-[var(--border-subtle)] text-xs text-[var(--text-tertiary)] gap-4">
          <p>&copy; 2026 Insidr Labs. MIT Licensed.</p>
        </div>
      </div>
    </footer>
  );
}
