"use client";

import React, { useEffect, useRef } from "react";
import { motion, useAnimation, useInView, type Variants } from "framer-motion";
import Link from "next/link";
import { Package, Wallet, Truck, CheckCircle, Scale, ArrowRight, SunMoon, UserCheck, Zap, HelpCircle, MailCheck, ShieldCheck, Plug, TrendingUp, Users, ExternalLink } from "lucide-react";
import Wordmark from "../components/brand/Wordmark";
import ScrollDot from "../components/brand/ScrollDot";
import DotIcon from "../components/brand/DotIcon";
import { useScrollDot } from "../components/brand/ScrollDotContext";
import { DOCS_URL, LACRE_APP_URL, LACRE_DIRECT_USE_URL, LACRE_REPO_URL, LACRE_ROUTER } from "../config/links";
import { NETWORKS } from "../config/networks";
import { DEFAULT_NETWORK, escrowAddress } from "../lib/genlayer/contracts";
import { useEscrowInfo } from "../lib/hooks/useEscrowInfo";
import { truncateAddress } from "../lib/wallet/format";

const ESCROW_ADDRESS = escrowAddress(DEFAULT_NETWORK);

// Utility for animating numbers
function Counter({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const isInView = useInView(nodeRef, { once: true });
  const controls = useAnimation();
  const [displayValue, setDisplayValue] = React.useState("0");

  useEffect(() => {
    if (isInView) {
      let startTime: number;
      const duration = 1200; // 1.2s

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        
        // easeOutQuart
        const ease = 1 - Math.pow(1 - progress, 4);
        const current = ease * value;

        if (nodeRef.current) {
          setDisplayValue(current.toFixed(decimals));
        }

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setDisplayValue(value.toFixed(decimals));
        }
      };
      
      requestAnimationFrame(animate);
    }
  }, [isInView, value, decimals]);

  return <span ref={nodeRef}>{displayValue}</span>;
}

export default function Page() {
  const { registerAnchor } = useScrollDot();
  const escrowInfo = useEscrowInfo();
  
  // Section refs
  const heroRef = useRef<HTMLDivElement>(null);
  const convergenceRef = useRef<HTMLDivElement>(null);
  const howItWorksRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const whyGenlayerRef = useRef<HTMLDivElement>(null);
  const lacreRef = useRef<HTMLDivElement>(null);
  const marketsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerAnchor("hero", heroRef);
    registerAnchor("convergence", convergenceRef);
    registerAnchor("how-it-works", howItWorksRef);
    registerAnchor("stats", statsRef);
    registerAnchor("why-genlayer", whyGenlayerRef);
    registerAnchor("lacre", lacreRef);
    registerAnchor("markets", marketsRef);
  }, [registerAnchor]);

  const fadeUp: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }
    }
  };

  return (
    <>
      <ScrollDot />
      
      {/* 1. Hero */}
      <section 
        id="hero" 
        className="relative min-h-[calc(100vh-64px)] flex flex-col items-center justify-center overflow-hidden"
      >
        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
          <div 
            className="w-[1200px] h-[1200px] rounded-full"
            style={{
              background: "radial-gradient(circle, var(--accent-dim) 0%, transparent 60%)",
              opacity: 0.08
            }}
          />
        </div>

        <motion.div 
          className="z-10 flex flex-col items-center text-center px-6"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeUp}
        >
          <div className="relative inline-block">
            <Wordmark size="xl" isHero={true} dotRef={heroRef} />
          </div>
          
          <p className="mt-8 text-[var(--text-secondary)] max-w-lg text-lg">
            P2P marketplace with escrow. Disputes judged by GenLayer validators reading the photos. Prediction markets coming soon.
          </p>

          <div className="mt-10 flex items-center gap-4">
            <Link 
              href="/marketplace" 
              className="bg-[var(--accent-primary)] hover:brightness-110 text-[var(--bg-deep)] px-6 py-3 rounded-md font-medium transition-all hover:-translate-y-0.5"
            >
              Browse marketplace
            </Link>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="border border-[var(--border-strong)] hover:border-[var(--text-secondary)] text-[var(--text-primary)] hover:brightness-110 px-6 py-3 rounded-md font-medium transition-all hover:-translate-y-0.5"
            >
              Read docs
            </a>
          </div>
        </motion.div>
      </section>

      {/* 2. The point */}
      <section id="convergence" className="py-32 px-6">
        <motion.div 
          className="max-w-[1024px] mx-auto flex flex-col items-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          <div className="relative text-center">
            <div ref={convergenceRef} className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-1 opacity-0" />
            <h2 className="text-5xl font-medium tracking-tight">The point where everyone meets.</h2>
            <p className="mt-6 text-lg text-[var(--text-secondary)] max-w-[640px] mx-auto">
              Pointmarket is a single point of convergence for three actors who normally operate on separate platforms.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mt-20">
            {/* Sellers */}
            <div className="flex flex-col items-start text-left">
              <div className="w-4 h-4 rounded-full bg-[var(--accent-primary)] mb-6" />
              <h3 className="text-xl font-semibold mb-3">Sellers</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                List physical goods with escrow protection. AI consensus arbitrates disputes, no human moderator required.
              </p>
            </div>
            
            {/* Buyers */}
            <div className="flex flex-col items-start text-left">
              <div className="w-4 h-4 rounded-full bg-[var(--accent-primary)] mb-6" />
              <h3 className="text-xl font-semibold mb-3">Buyers</h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Pay with locked funds released only on confirmed delivery. Disputes resolved by validator quorum.
              </p>
            </div>

            {/* Predictors */}
            <div className="flex flex-col items-start text-left">
              <div className="w-4 h-4 rounded-full bg-[var(--accent-primary)] mb-6" />
              <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                Predictors <SoonTag />
              </h3>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Take positions on marketplace activity. Objective markets will read on-chain state; subjective markets will resolve via LLM consensus.
              </p>
            </div>
          </div>
        </motion.div>
      </section>

      {/* 3. How it works */}
      <section id="how-it-works" className="scroll-mt-16 py-32 px-6 bg-[var(--bg-elevated)]">
        <motion.div 
          className="max-w-[1024px] mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          <div className="text-center mb-20">
            <h2 className="text-4xl font-medium tracking-tight">How it works.</h2>
            <p className="mt-4 text-[var(--text-secondary)]">One escrow. Disputes settled on GenLayer.</p>
          </div>

          <div className="relative">
            {/* Marketplace flow */}
            <div className="flex flex-col lg:flex-row items-center justify-between gap-4 relative z-10">
              <FlowStep icon={<Package size={20} />} label="List" />
              <ArrowRight className="text-[var(--border-strong)] hidden lg:block" size={20} />
              <FlowStep icon={<Wallet size={20} />} label="Buy" />
              <ArrowRight className="text-[var(--border-strong)] hidden lg:block" size={20} />
              <FlowStep icon={<Truck size={20} />} label="Ship" />
              <ArrowRight className="text-[var(--border-strong)] hidden lg:block" size={20} />
              <FlowStep icon={<CheckCircle size={20} />} label="Deliver" />
              <ArrowRight className="text-[var(--border-strong)] hidden lg:block" size={20} />
              <div className="relative">
                <div ref={howItWorksRef} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 opacity-0" />
                <FlowStep icon={<Scale size={20} />} label="Resolve" active />
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* 4. Live stats */}
      <section id="stats" className="py-24 px-6">
        <motion.div 
          className="max-w-[1024px] mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          <div className="mb-12 relative">
            <div ref={statsRef} className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 -translate-x-8 opacity-0 hidden md:block" />
            <h2 className="text-3xl font-medium tracking-tight">Live on Testnet Bradbury.</h2>
            <a
              href={`${NETWORKS[DEFAULT_NETWORK].explorerUrl}/address/${ESCROW_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Escrow {truncateAddress(ESCROW_ADDRESS)} <ExternalLink size={12} />
            </a>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <StatCard label="Total trades" loading={escrowInfo.isLoading} failed={escrowInfo.isError}>
              {escrowInfo.data ? <Counter value={Number(escrowInfo.data.total_trades)} /> : null}
            </StatCard>
          </div>
        </motion.div>
      </section>

      {/* 5. Why GenLayer */}
      <section id="why-genlayer" className="scroll-mt-16 py-32 px-6">
        <motion.div 
          className="max-w-[1280px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-8 items-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          {/* Left */}
          <div>
            <h2 className="text-4xl font-medium tracking-tight">Why GenLayer.</h2>
            <p className="mt-6 text-[var(--text-secondary)] text-base leading-relaxed max-w-[480px]">
              Trustless dispute resolution requires natural-language judgment. Solidity cannot make those calls without a centralized oracle or arbiter. GenLayer&apos;s Optimistic Democracy uses LLM-running validators as the consensus layer. The validators are the arbiters. No human moderation. No off-chain oracle. No single point of trust.
            </p>
            <a 
              href="https://genlayer.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-8 text-[var(--accent-primary)] hover:text-[var(--accent-hover)] transition-colors font-medium"
            >
              Read the protocol docs <ArrowRight size={16} />
            </a>
          </div>

          {/* Right */}
          <div className="relative flex flex-col items-center justify-center p-8 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)]">
            <div ref={whyGenlayerRef} className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 opacity-0" />
            
            {/* Top */}
            <div className="w-48 py-4 border border-[var(--border-strong)] rounded-lg text-center font-medium bg-[var(--bg-deep)]">
              Smart contract
            </div>
            
            <div className="h-6 w-px bg-[var(--border-strong)]" />
            
            {/* Middle */}
            <div className="w-64 py-4 border border-[var(--border-strong)] rounded-lg text-center font-medium bg-[var(--bg-deep)] flex flex-col items-center justify-center gap-2">
              <span>GenVM validators (5)</span>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-[var(--text-secondary)]" />
                ))}
              </div>
            </div>

            <div className="h-6 w-px bg-[var(--border-strong)]" />
            
            {/* Bottom */}
            <div className="w-56 py-4 border border-[var(--border-strong)] rounded-lg text-center font-medium bg-[var(--bg-deep)] flex flex-col items-center justify-center gap-2">
              <span>LLM consensus</span>
              <div className="flex gap-3">
                <div className="w-3 h-3 rounded-sm bg-[var(--accent-primary)] opacity-80" />
                <div className="w-3 h-3 rounded-sm bg-[var(--accent-primary)] opacity-60" />
                <div className="w-3 h-3 rounded-sm bg-[var(--accent-primary)] opacity-40" />
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* 6. Delivery proof (Lacre) */}
      <section id="lacre" className="scroll-mt-16 py-32 px-6 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)]">
        <motion.div
          className="max-w-[1024px] mx-auto relative"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          <div ref={lacreRef} className="absolute left-0 top-0 w-4 h-4 -translate-x-8 opacity-0 hidden md:block" />

          <div className="max-w-[640px]">
            <h2 className="text-4xl font-medium tracking-tight">Delivery proof, powered by Lacre.</h2>
            <p className="mt-6 text-[var(--text-secondary)] text-base leading-relaxed">
              Lacre is a GenLayer primitive that turns a DKIM-signed email into a public on-chain record.
              Validators check the signature by consensus, so any contract can trust the record without
              trusting the person who submitted it.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-6 text-sm font-medium">
              <a
                href={LACRE_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--accent-primary)] hover:text-[var(--accent-hover)] transition-colors"
              >
                lacre.in-sidr.xyz <ExternalLink size={14} />
              </a>
              <a
                href={LACRE_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Source on GitHub <ExternalLink size={14} />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <InfoCard icon={<MailCheck size={20} />} title="In Pointmarket">
              <ol className="space-y-3 list-decimal pl-4">
                <li>
                  After shipping, the seller attests the carrier&apos;s shipping email (amazon.com, ups.com,
                  fedex.com or dhl.com) on Lacre and submits the record id on the trade.
                </li>
                <li>
                  The Escrow accepts it only if the record is valid and aligned, comes from an allowed carrier,
                  was signed after the buyer paid, and is not used by another trade.
                </li>
                <li>
                  Once accepted, the seller&apos;s claim window gets shorter, and a &quot;not received&quot; claim
                  against a valid proof is decided by rule.
                </li>
              </ol>
            </InfoCard>

            <InfoCard icon={<ShieldCheck size={20} />} title="What it proves">
              <p>
                A delivery proof shows that the carrier sent that email. It does not show that the parcel
                reached the door, or what was inside it.
              </p>
              <p className="mt-3">
                It is optional. Trades without one follow the normal claim window and dispute flow.
              </p>
            </InfoCard>

            <InfoCard icon={<Plug size={20} />} title="For other GenLayer dapps">
              <p>
                Any contract can read a Lacre record through the Lacre Router with{" "}
                <span className="font-mono text-[var(--text-primary)]">require_attestation</span>.
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--text-primary)] break-all">{LACRE_ROUTER}</p>
              <a
                href={LACRE_DIRECT_USE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-4 text-[var(--accent-primary)] hover:text-[var(--accent-hover)] transition-colors font-medium"
              >
                Integration guide <ArrowRight size={14} />
              </a>
            </InfoCard>
          </div>
        </motion.div>
      </section>

      {/* 7. Markets (coming soon) */}
      <section id="markets" className="scroll-mt-16 py-32 px-6">
        <motion.div
          className="max-w-[1024px] mx-auto relative"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeUp}
        >
          <div ref={marketsRef} className="absolute left-0 top-0 w-4 h-4 -translate-x-8 opacity-0 hidden md:block" />

          <div className="max-w-[640px]">
            <div className="flex items-center gap-3">
              <h2 className="text-4xl font-medium tracking-tight">Markets.</h2>
              <SoonTag />
            </div>
            <p className="mt-6 text-[var(--text-secondary)] text-base leading-relaxed">
              Markets is the prediction market that will live inside the marketplace. People will take
              positions on how trades and listings turn out, and GenLayer&apos;s validators will settle each
              market by consensus. It is not open yet.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            <InfoCard icon={<TrendingUp size={20} />} title="Take a position">
              <p>Back an outcome on marketplace activity, from a single trade to the market as a whole.</p>
            </InfoCard>
            <InfoCard icon={<Users size={20} />} title="Settled by validators">
              <p>
                Objective questions read on-chain state. Subjective ones are judged by GenLayer&apos;s validators,
                with no human resolver.
              </p>
            </InfoCard>
            <InfoCard icon={<Package size={20} />} title="Inside the marketplace">
              <p>Markets will sit next to the listings they are about, under the same wallet you trade with.</p>
            </InfoCard>
          </div>
        </motion.div>
      </section>
    </>
  );
}

// Subcomponents

function FlowStep({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center p-4 w-32 rounded-xl border ${active ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'border-[var(--border-subtle)] bg-[var(--bg-deep)]'}`}>
      <div className={`mb-3 ${active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`}>
        {icon}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

function StatCard({
  label,
  children,
  suffix = "",
  loading = false,
  failed = false,
}: {
  label: string;
  children: React.ReactNode;
  suffix?: string;
  loading?: boolean;
  failed?: boolean;
}) {
  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-6 flex flex-col justify-between">
      <div className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-wide mb-2 flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            loading ? "bg-[var(--border-strong)] animate-pulse" : failed ? "bg-red-400" : "bg-[var(--success)]"
          }`}
        />
        {loading ? "Loading..." : failed ? "Unavailable" : "On-chain"}
      </div>
      <div className="text-3xl font-semibold mt-2">
        {loading || failed ? <span className="text-[var(--text-tertiary)]">-</span> : children}
        {!loading && !failed ? <span className="text-lg text-[var(--text-secondary)]">{suffix}</span> : null}
      </div>
      <div className="mt-2 text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-widest">
        {label}
      </div>
    </div>
  );
}

function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-deep)] flex flex-col">
      <div className="mb-4 text-[var(--accent-primary)]">{icon}</div>
      <h3 className="text-base font-semibold mb-3">{title}</h3>
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed">{children}</div>
    </div>
  );
}

function SoonTag() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-[var(--bg-elevated-2)] border border-[var(--border-subtle)] text-[var(--text-tertiary)]">
      Coming soon
    </span>
  );
}
