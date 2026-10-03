import type { Address } from "./types";

/**
 * Deployed contract addresses per network.
 *
 * v1.5 splits the old Marketplace in two: the Escrow holds trades, windows
 * and all money; the Arbiter holds the burden rules and the jury and moves
 * nothing but one `settle` message to the Escrow. The Lacre Router is how
 * the Escrow (and this frontend) finds the Verifier that holds delivery
 * proof records.
 *
 * The v1.4.x Marketplace contracts stay listed as legacy sources. They are
 * read only: the app shows their trades so history does not disappear, and
 * never writes to them. The PredictionMarket keeps its existing contract.
 *
 * Earlier v1.5 Escrow deployments are listed as archived Escrows: same ABI
 * as the live Escrow, read with the same code, and also never written to.
 */

export type NetworkKey = "studionet" | "testnetAsimov" | "testnetBradbury" | "testnetBradburyDemo";

export interface LegacyMarketplace {
  /** Short key used in URLs: /legacy/<key>/<tradeId>. */
  key: string;
  label: string;
  address: Address;
}

/** An earlier v1.5 Escrow (same ABI as the live one), read only. */
export interface ArchivedEscrow {
  /** Short key used in URLs: /legacy/<key>/<tradeId>. */
  key: string;
  label: string;
  address: Address;
}

export interface NetworkAddresses {
  escrow: Address | null;
  arbiter: Address | null;
  lacreRouter: Address | null;
  predictionMarket: Address | null;
  legacyMarketplaces: LegacyMarketplace[];
  archivedEscrows: ArchivedEscrow[];
}

const LACRE_ROUTER_BRADBURY = "0xEf37cb72C3A9dD6bCE2f3575B75c94C555F9c8d9" as Address;

const LEGACY_MARKETPLACE_V147: LegacyMarketplace = {
  key: "v147",
  label: "Marketplace v1.4.7",
  address: "0x68546F0a8d2Af91d5917A03245c1D31296487b3F" as Address,
};

// Same v1.4.7 interface with demo windows. The trades this app showed
// before v1.5 live here, so it stays readable next to v1.4.7.
const LEGACY_MARKETPLACE_DEMO_V903: LegacyMarketplace = {
  key: "v903",
  label: "MarketplaceDemo v903",
  address: "0xB84B0683618898769EaCdca7062f9439510878CE" as Address,
};

// EscrowProofDemo: the run that took a Lacre delivery proof end to end.
// Its carrier domains include gmail.com as a stand-in carrier; trade 0
// carries delivery_proof 6.
const ARCHIVED_ESCROW_LACRE_PROOF: ArchivedEscrow = {
  key: "lacre-proof",
  label: "Lacre proof run",
  address: "0x5E6f188CEdEAF210135F4f23bd9dd68ea836a818" as Address,
};

// The first EscrowDemo + Arbiter pair. Trade 0 went to a dispute the seller won.
const ARCHIVED_ESCROW_V15_FIRST: ArchivedEscrow = {
  key: "v15-first",
  label: "v1.5 first pair",
  address: "0xD637Af7BbFeD058EaD69D5639dfD7Ff5cDb2E614" as Address,
};

export const ADDRESSES: Record<NetworkKey, NetworkAddresses> = {
  studionet: {
    escrow: null,
    arbiter: null,
    lacreRouter: null,
    predictionMarket: "0x2b0B5f76Db290D77DF53250B7f0540fc2D8cb48E" as Address,
    legacyMarketplaces: [
      {
        key: "v144",
        label: "Marketplace v1.4.4",
        address: "0x29f58D5ACC8b85250D3Dae2692DEADED346c6e67" as Address,
      },
    ],
    archivedEscrows: [],
  },
  testnetAsimov: {
    escrow: null,
    arbiter: null,
    lacreRouter: null,
    predictionMarket: null,
    legacyMarketplaces: [],
    archivedEscrows: [],
  },
  testnetBradbury: {
    // Production v1.5 is not deployed yet.
    escrow: null,
    arbiter: null,
    lacreRouter: LACRE_ROUTER_BRADBURY,
    predictionMarket: "0x10717D9814Ace2098862299C26806a2899eAB204" as Address,
    legacyMarketplaces: [LEGACY_MARKETPLACE_V147],
    archivedEscrows: [],
  },
  testnetBradburyDemo: {
    // EscrowDemo v950 and Arbiter v151, wired by set_arbiter on 2026-10-02.
    escrow: "0xA8a745389ba94E1915789b0b7a7aB8c0eEeD68B3" as Address,
    arbiter: "0xbd5CEABE0cFCF5c4Ae569D027ca9275D1F511fe8" as Address,
    lacreRouter: LACRE_ROUTER_BRADBURY,
    predictionMarket: "0x82d83E3354A1896EA87684ADE9892834e52f1c0a" as Address,
    legacyMarketplaces: [LEGACY_MARKETPLACE_V147, LEGACY_MARKETPLACE_DEMO_V903],
    archivedEscrows: [ARCHIVED_ESCROW_LACRE_PROOF, ARCHIVED_ESCROW_V15_FIRST],
  },
};

export const DEFAULT_NETWORK: NetworkKey = "testnetBradburyDemo";

function required(value: Address | null, what: string, network: NetworkKey): Address {
  if (value === null) {
    throw new Error(`Pointmarket has no ${what} on ${network}. Check lib/genlayer/contracts.ts.`);
  }
  return value;
}

export function escrowAddress(network: NetworkKey): Address {
  return required(ADDRESSES[network].escrow, "Escrow", network);
}

export function arbiterAddress(network: NetworkKey): Address {
  return required(ADDRESSES[network].arbiter, "Arbiter", network);
}

export function lacreRouterAddress(network: NetworkKey): Address {
  return required(ADDRESSES[network].lacreRouter, "Lacre Router", network);
}

export function predictionMarketAddress(network: NetworkKey): Address {
  return required(ADDRESSES[network].predictionMarket, "PredictionMarket", network);
}

export function legacyMarketplaces(network: NetworkKey): LegacyMarketplace[] {
  return ADDRESSES[network].legacyMarketplaces;
}

export function findLegacyMarketplace(
  network: NetworkKey,
  key: string,
): LegacyMarketplace | undefined {
  return ADDRESSES[network].legacyMarketplaces.find((m) => m.key === key);
}

export function archivedEscrows(network: NetworkKey): ArchivedEscrow[] {
  return ADDRESSES[network].archivedEscrows;
}

export function findArchivedEscrow(
  network: NetworkKey,
  key: string,
): ArchivedEscrow | undefined {
  return ADDRESSES[network].archivedEscrows.find((e) => e.key === key);
}
