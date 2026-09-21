# When and why the 2^24 per-transaction gas cap appeared on Testnet Bradbury

Read-only investigation, 2026-09-21. No transaction was sent. Everything below
comes from the public L2 RPC (`https://rpc.testnet-chain.genlayer.com`), the
public GitHub repositories of `matter-labs` and `genlayerlabs`, and the public
issue tracker.

## Answer in three lines

The cap arrived with a **protocol upgrade applied to the GenLayer L2 at block
21,205,822, 2026-09-09 12:09:27 UTC**. The value 16,777,216 is not GenLayer's:
it is **`DEFAULT_MAX_TX_GAS_LIMIT = 1 << 24`** in ZKsync OS, the EIP-7825
per-transaction gas cap, introduced upstream by `matter-labs/zksync-os` PR #683
on 2026-06-16. It is a **chain configuration parameter, not a fixed constant**:
a chain may raise it, and is forbidden from lowering it.

--------------------------------------------------------------------------------
## 1. On-chain: the transition

### Method

Transactions above 2^24 are a small fraction of traffic, so a naive binary
search on single blocks would give a false negative on any quiet stretch. The
predicate used instead is "does a window of consecutive blocks contain at least
one transaction with `gas > 2^24`", with the window's transaction count and its
count above 8M gas reported alongside as an activity control. Three passes:

1. `gas_cap_bisect.py` -- windows of 40,000 blocks, bisecting 11,409,034
   (2026-05-30, known to contain one) against the head. Three iterations placed
   the transition after 2026-09-08.
2. `gas_cap_grid.py` -- 27 windows of 2,000 blocks spread over
   21,183,052..22,490,000, which bracketed the transition to a single 12-hour
   stretch on 2026-09-09 and confirmed nothing above the cap through
   2026-09-21.
3. `gas_cap_edge.py` -- a contiguous scan of 21,184,500..21,235,399, every
   block, every transaction, to find the exact edge.

All three read `eth_getBlockByNumber(full=true)` in batched, concurrent JSON-RPC
calls. About 210,000 blocks were read in total.

### The transition block

    LAST transaction with gas limit above 2^24
      block      21,205,822
      timestamp  1788955767 = 2026-09-09 12:09:27 UTC
      gas limit  72,000,000
      gas used    9,229,456     status 1 (success)
      type       0x7e = UpgradeTxType
      from       0x0000000000000000000000000000000000008007  (force deployer)
      to         0x000000000000000000000000000000000000800f  (upgrader)
      input      13,988 bytes
      tx         0x756696b4c9434f059369d35efed4e9f852f4a4f7343d319a9b576777b4f56fdb

    FIRST block after which none appear
      block      21,205,823 onward, verified contiguously to 21,235,399 and by
                 26 sampled windows through 2026-09-21 18:26 UTC

The last transaction over the cap **is the upgrade transaction that imposed
it**. That is not a coincidence: upgrade and service transactions are exempt
from the check (see section 2), so the upgrade could carry 72,000,000 gas while
capping everything after it at 16,777,216.

The last *ordinary* transaction above the cap was three minutes earlier:

    block 21,205,619, 2026-09-09 12:06:42 UTC, gas limit 24,974,206, type 0x2

### Highest gas limit seen before and after

| window | date | ntx | over 2^24 | highest tx gas limit |
|---|---|---:|---:|---:|
| 10,400,000..10,405,999 | 2026-05-20 | 28,289 | 0 | 9,017,992 |
| 11,407,500..11,413,499 | 2026-05-30 | 12,815 | 1 | 17,848,425 |
| 16,954,187..16,994,186 | 2026-08-08 | 119,250 | 2,154 | 76,150,832 |
| 19,746,764..19,786,763 | 2026-08-30 | 226,282 | 5,043 | 100,000,000 |
| 21,143,052..21,183,051 | 2026-09-08 | 113,519 | 11,863 | 100,000,000 |
| 21,199,500..21,205,822 | 2026-09-09, up to the upgrade | 11,740 | 20 | 72,000,000 (upgrade tx); 70,085,546 excluding it |
| **upgrade at 21,205,822, 2026-09-09 12:09:27 UTC** | | | | |
| 21,205,823..21,211,999 | 2026-09-09, from the upgrade | 10,283 | 0 | 11,540,156 |
| 21,434,387..21,436,386 | 2026-09-11 | 3,812 | 0 | 16,767,085 |
| 21,987,324..21,989,323 | 2026-09-16 | 3,615 | 0 | **16,777,216 (exactly the cap)** |
| 22,489,994..22,491,993 | 2026-09-21 | 3,538 | 0 | 13,875,596 |

Before the upgrade, limits of 70-100 million were routine -- 11,863 of them in
one 40,000-block window eight hours earlier. After it, across every window
sampled between 2026-09-09 and 2026-09-21, not one transaction exceeds
16,777,216, and at least one sits exactly on it.

### The block gas limit did not change

`gasLimit` in the block header is **100,000,000 at every point checked**:
blocks 10,579,477 (2026-05-21), 11,500,000, 13,000,000, 15,000,000, 17,000,000,
19,000,000, 21,000,000, 22,499,000 (2026-09-21), and every one of the 400 blocks
around the transition. The cap is therefore not a block-level parameter change,
and it is not the block gas limit leaking into transaction validation. The two
numbers are independent: 100,000,000 per block, 16,777,216 per transaction.

### Two further markers at the same block

* **A new transaction type appears.** Before block 21,205,822 the chain carries
  types `0x0`, `0x2` and (rarely) `0x7e`. Starting at block 21,205,823 a fourth
  type appears and then runs continuously: `0x7d`, which
  `zksync-os-server/lib/types/src/receipt/envelope.rs:57-59` documents as the
  interop/system transaction type. 155 of them in the first 6,000 blocks after
  the upgrade, zero before it.
* **A block-production gap.** Block 21,205,323 to 21,205,324 spans 46 seconds
  against a ~1 second norm, about six minutes before the upgrade transaction --
  the signature of a sequencer restart.

--------------------------------------------------------------------------------
## 2. In code: where 16,777,216 comes from

### It is ZKsync OS, and the node says so

    eth_getBlockByNumber -> "invalid transaction: BlockPubdataLimitReached"
    web3_clientVersion   -> "zksync-os/v0.24.0"

The pubdata error string matches
`zksync-os-server/lib/rpc/src/eth_call_handler.rs:789` (`#[error("invalid
transaction: {0:?}")]`) over
`InvalidTransaction::BlockPubdataLimitReached`
(`lib/sequencer/src/execution/execute_block_in_vm.rs:596`), and
`web3_clientVersion` names the stack outright. GenLayer Chain runs
`matter-labs/zksync-os-server`.

### The constant

`matter-labs/zksync-os`, tag `v0.4.0`,
`zk_ee/src/system/metadata/chain_config.rs:12-15`:

    /// EIP-7825 single-transaction gas limit (2^24). This is both the default
    /// per-tx gas cap and the lower bound for any chain-configured value: a chain
    /// may raise the cap above Ethereum's limit but must not set it below.
    pub const DEFAULT_MAX_TX_GAS_LIMIT: u64 = 1 << 24;

16,777,216 exactly. Same value, same provenance, in `alloy`:
`crates/eips/src/eip7825.rs`, `MAX_TX_GAS_LIMIT_OSAKA: u64 = 2u64.pow(24)`,
"as defined by EIP-7825 activated in `Osaka` hardfork".

### Chain config parameter, not a hardcoded constant

`ChainConfig` (same file) carries three fields -- `chain_id`,
`fri_proof_verification_enabled`, `max_tx_gas_limit` -- is read once per run
from the oracle, is frozen for a batch, and is **committed into the batch public
input** as a keccak256 hash, so proofs bind to the rules the batch ran under.
The cap is configurable, in one direction only (`validate()`, same file):

    // The per-tx gas cap must not be configured below Ethereum's EIP-7825
    // single-transaction gas limit; a chain may only raise it.
    if self.max_tx_gas_limit < DEFAULT_MAX_TX_GAS_LIMIT { ... }

So GenLayer, as the chain admin, **can raise the cap without any upstream
change**; it cannot go below 2^24, and there is no evidence it has set the value
at all, which leaves it at the default.

### Where it is enforced, and why estimation does not see it

Protocol level, `zksync-os` v0.4.0,
`basic_bootloader/src/bootloader/transaction_flow/zk/validation_impl.rs:76-89`:

    // Validate that the tx gas limit doesn't exceed the effective per-tx
    // limit, for non-service transactions. Call simulation intentionally skips
    // normal tx-admission checks so RPC callers can estimate with a high gas
    // ceiling.
    if !Config::SIMULATION && !transaction.is_service() {
        let individual_limit = system.get_individual_tx_gas_limit();
        require!(tx_gas_limit <= individual_limit,
                 InvalidTransaction::CallerGasLimitMoreThanTxLimit, system)?;
    }

with `get_individual_tx_gas_limit()` = `min(block_gas_limit, max_tx_gas_limit)`
(`zk_ee/src/system/mod.rs:173-178`), and service transactions exempted
(`basic_bootloader/.../rlp_encoded/transaction.rs:252`,
`RlpEncodedTxInner::Service(_) => MAX_TX_GAS_LIMIT`).

Two consequences we measured directly:

* `eth_call` and `eth_estimateGas` accept `gas` of 30,000,000 and 100,000,000
  on both `rpc-bradbury.genlayer.com` and `rpc.testnet-chain.genlayer.com`
  today -- the `Config::SIMULATION` exemption -- while
  `eth_sendRawTransaction` refuses 2^24+1. Estimation cannot warn you.
* The upgrade transaction at block 21,205,822 carried 72,000,000 gas after the
  cap took effect, because it is a service transaction.

Submission level: the message our probe saw is reth's, surfaced by the ZKsync OS
RPC. `paradigmxyz/reth` v2.5.0,
`crates/rpc/rpc-eth-types/src/error/mod.rs:689-691`:

    /// Thrown if the transaction gas limit exceeds the maximum
    #[error("gas limit too high")]
    GasLimitTooHigh,

raised in `crates/transaction-pool/src/validate/eth.rs:635-639` ("Transaction
gas limit validation (EIP-7825 for Osaka+)") when the pool's `tx_gas_limit_cap`
is non-zero and exceeded, and mapped to JSON-RPC code **-32602** by
`zksync-os-server/lib/rpc/src/result.rs:87`
(`EthSendRawTransactionError::PoolError(_) => invalid_params_rpc_err(...)`).
That is exactly the `-32602 gas limit too high` this probe recorded at
`gas = 16,777,217`.

One gap worth stating plainly: in public `zksync-os-server` main the reth chain
spec is built `cancun_activated`
(`lib/reth_compat/src/provider.rs:47-52`), and revm returns `u64::MAX` for
`tx_gas_limit_cap()` before Osaka
(`bluealloy/revm`, `crates/context/src/cfg.rs:448-455`), so the public-main
wiring alone would not arm the pool check. The node runs `zksync-os/v0.24.0`,
and the newest public release is v0.23.0 (2026-08-24), so **the exact line that
arms the pool-level check in the running build is not in any public source**.
UNVERIFIED. The protocol-level enforcement above is not in doubt, and the
on-chain evidence shows the cap is in force.

### Dates on the upstream change

| date | what | source |
|---|---|---|
| 2026-06-16 | `max_tx_gas_limit` introduced, defaulting to and floored at `1 << 24` | `matter-labs/zksync-os` commit `e5479877`, PR #683 "feat: add runtime chain config", merged 2026-06-16T19:05:49Z |
| 2026-08-07 | server picks up zksync-os 0.4.0 | `zksync-os-server` #1421, commit `59bb218`; released in v0.22.0 (2026-08-10) |
| 2026-08-18 | reth bumped to v2.5.0 (the pool-level EIP-7825 check) | `zksync-os-server` #1518, commit `8f17d02` |
| 2026-08-19 | v32.0 proving lane made real on L1 | `zksync-os-server` #1510, commit `0bafb13` |
| 2026-08-20 | `zksync-os` v0.4.0 tagged | tag `v0.4.0`, commit `69bc4305` |
| 2026-08-24 | `zksync-os-server` v0.23.0 released, carrying #1510, #1518, #1532 | release notes |
| 2026-09-09 | **the upgrade lands on the GenLayer L2** | block 21,205,822, this document |

### The rationale, in the author's words

PR #683, "Why":

> FRI proof verification is only needed for Gateway chains, while the per-tx gas
> limit may be configured by customer chains. Making these runtime config --
> instead of per-block metadata or build-time flags -- lets one binary serve
> different chains, with the public input pinning the exact rules each batch was
> executed under.

and in the field list:

> `max_tx_gas_limit: u64` -- EIP-7825 single-transaction gas cap; effective
> per-tx limit is `min(block_gas_limit, max_tx_gas_limit)`. Floored at and
> defaults to `1 << 24`.

--------------------------------------------------------------------------------
## 3. Independent corroboration

* `genlayerlabs/genlayer-cli` issue **#419**, "Bradbury rejects Governor
  deployment above a sub-16M gas ceiling", opened 2026-09-15 -- six days after
  the upgrade. A comment on 2026-09-18 reports a gas sweep on a small deploy:
  16,777,216 accepted, 16,800,000 and above rejected with `gas limit too high`.
  Same boundary this probe found by binary search at 1-gas granularity
  (2^24 accepted, 2^24+1 refused).
* `genlayerlabs/genlayer-cli` issue **#402**, opened 2026-07-31, is the separate
  problem of signing at the raw `eth_estimateGas` result and reverting; it
  predates the cap and is unrelated to it.
* No maintainer reply on either issue names the cap, its value, its date or its
  cause. As of today #419 is open with the reporter "pausing further deployment
  attempts pending guidance".
* `docs.genlayer.com/validators/changelog` has no entry after 2026-08-05 and
  says nothing about a chain upgrade, a gas cap or transaction size limits.

--------------------------------------------------------------------------------
## 4. Conclusion

Split, because the two halves of the question have different answers.

**The constant: (a) deliberate change with cited rationale.** 16,777,216 is
EIP-7825's per-transaction gas cap, adopted by ZKsync OS as the default and the
floor of a new runtime chain config, in `matter-labs/zksync-os` PR #683 merged
2026-06-16, with the rationale quoted above and the value committed into the
batch public input. Nothing about it is accidental, and nothing about it is
GenLayer-specific.

**Its arrival on Bradbury: (b) a change without stated rationale.** It reached
the chain as part of an unannounced protocol upgrade at block 21,205,822 on
2026-09-09 12:09:27 UTC -- a date this study establishes from chain data, not
from any announcement. No GenLayer changelog, release note, docs page or issue
reply mentions the upgrade, the cap, or the consequence that contracts which
deployed in May no longer deploy. Builders found it by hitting it: issue #419
was filed six days later.

Two things specifically **cannot** be determined from public sources:

1. Whether GenLayer chose to keep the 2^24 default or simply inherited it. The
   upstream design lets a chain admin raise `max_tx_gas_limit`, so leaving it at
   the default is a decision, but there is no public artifact recording one.
2. The exact code path in the running `zksync-os/v0.24.0` build that arms the
   submission-time check, since no public release carries that version.

What would settle both: the `max_tx_gas_limit` value in the chain config
committed to Bradbury's batch public inputs (or the chain-admin transaction that
sets it on L1), the node operator's release note for the 2026-09-09 upgrade, and
a maintainer answer on `genlayer-cli#419`.

**Practical consequence.** Raising the cap does not require an upstream change
or a fork: ZKsync OS explicitly permits a chain to configure
`max_tx_gas_limit` above 2^24. That makes "raise the per-transaction gas cap" a
concrete, low-cost ask for the GenLayer chain admin -- distinct from, and easier
than, the chunked-deployment request that a fixed protocol limit would force.

--------------------------------------------------------------------------------
## Scripts used

All read-only, in this directory.

| script | what it does |
|---|---|
| `gas_cap_history_scan.py` | batched concurrent `eth_getBlockByNumber(full=true)` fetcher, plus a single-window summary |
| `gas_cap_grid.py` | samples N windows of consecutive blocks across a range, reporting transactions above 2^24 per window |
| `gas_cap_bisect.py` | bisects a block range on the predicate "this window contains a transaction above 2^24" |
| `gas_cap_edge.py` | contiguous scan of a bracketed range to find the exact last transaction above the cap |
| `gas_hist.py` | gas-limit distribution of a block window, used to size the windows above |
| `gas_cap_search.py` | the original submission-side binary search that found the cap (from the deploy probe; it signs, so it was not re-run here) |

Logs from this run: `grid1.log`, `bisect1.log`, `grid2.log`, `edge1.log`.

Repository sources were verified against tag-pinned files fetched from
`raw.githubusercontent.com` and against a shallow clone of
`matter-labs/zksync-os-server` made under this directory for grepping and
removed afterwards.
