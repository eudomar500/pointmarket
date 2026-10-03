# Pointmarket frontend

The dApp frontend for Pointmarket. P2P marketplace with escrow. Disputes judged by GenLayer validators reading the photos. Prediction markets coming soon.

Built with Next.js 15, TypeScript, Tailwind CSS v4, and GenLayerJS.

## Status

Ported to v1.5; targets EscrowDemo v950 and Arbiter v151 on Testnet Bradbury by default.

## Setup

Requires Node.js 20 or higher and pnpm.

```
cd frontend
pnpm install
cp .env.local.example .env.local
pnpm dev
```

The dev server runs at http://localhost:3000.

## Architecture

```
frontend/
  app/                       Next.js App Router pages
  components/                React components organized by concern
  lib/
    genlayer/                SDK wrappers (typed reads, writes, client, types)
    hooks/                   React hooks for contract state
  config/                    Network metadata
```

The `lib/genlayer` module is the only place that touches the SDK. All reads and writes go through typed wrappers. UI code never imports `genlayer-js` directly.

## Deployed contracts

Testnet Bradbury (chain 4221):

| Contract | Address |
|---|---|
| EscrowDemo | `0xA8a745389ba94E1915789b0b7a7aB8c0eEeD68B3` |
| Arbiter | `0xbd5CEABE0cFCF5c4Ae569D027ca9275D1F511fe8` |

Source code and protocol documentation: see `../contracts/` and `../docs/` in the repo root.

## Wallet support

The dApp uses EIP-6963 multi-wallet detection. Any EIP-1193 compatible browser wallet works. Tested with Rabby and MetaMask.

To use the GenLayer Testnet Bradbury in your wallet:

1. Open wallet settings, add custom network
2. RPC URL: `https://rpc-bradbury.genlayer.com`
3. Chain ID: `4221`
4. Currency symbol: GEN

## Code style

This frontend follows the same code style rules as the rest of the repo:

- No em-dashes, use `--`
- No Unicode arrows, use `->`
- No emojis in code, UI copy, or commit messages
- Factual prose tone, no marketing language
- Conventional Commits

## License

MIT
