# WASM deployment probe (throwaway measurement experiment)

## Purpose

Two questions, both raised by `docs/PRIMITIVES_STUDY.md` section F and both
unanswerable from source alone:

1. **Does Testnet Bradbury load and execute a raw WASM contract at all?** The
   only prior art, `github.com/genlayerlabs/tls-twitter-bounty`, deploys its
   210 KB `tls-verifier-wasm/verifier.wasm` through an unsigned `gen_call`
   against a local Studio endpoint. Studio simulates the consensus pipeline and
   does not verify signatures, so a Studio deploy proves nothing about a real
   network.
2. **What are the actual size and gas ceilings for a deployment on Bradbury?**
   The study could only record them as UNVERIFIED, because they are not GenVM
   constants.

The first answer is yes. The second answer turned out to matter more than the
first: the ceilings exclude both the existing WASM verifier and this
repository's own deployed `contracts/Marketplace.py`.

That repository was cloned out of tree to read the verifier and its build
setup. It is not vendored here; it is referenced by URL.

## What was measured

All of it against the live public RPCs, `https://rpc-bradbury.genlayer.com` and
`https://rpc.testnet-chain.genlayer.com`, with nothing signed unless the table
below says a transaction was sent.

| finding | value | how |
|---|---|---|
| per-transaction gas cap | exactly 2^24 = 16,777,216 | binary search on `eth_sendRawTransaction` validation with a zero-balance key (`gas_cap_search.py`) |
| pubdata ceiling | between 52,736 and 52,992 bytes of payload | payload sweep through `eth_estimateGas` (`size_sweep.py`) |
| cost of contract code | about 730 gas per byte of source | estimate sweep (`estimate_source.py`) |
| practical deploy ceiling | about 20 kB of code, less with a safety margin | the gas cap divided by the above |
| `eth_estimateGas` accuracy | understates by the intrinsic calldata cost | a deploy signed at the raw estimate reverted; `debug_traceCall` at the same limit succeeds (`find_l2_tx.py`) |
| raw WASM execution | works | the deploy trace below |

## The two deploy transactions

Both sent from `0xf27e3a6d7bf4bfc0a837020fd74e73055af17d53`, both deploying the
same 1,447-byte `tiny-wasm/tiny_probe.wasm`.

**1. Signed at the raw estimate: reverted out of gas.**

    L2 tx     : 0xd6255f352501dcc102869c201dce91c901fb2e40c354d54428cbc19271b8848e
    block     : 22,498,212
    gas limit : 2,222,870   (exactly the eth_estimateGas result)
    gas used  : 2,122,093
    status    : 0 (REVERTED), 0 logs, no NewTransaction event
    cost      : 4,509,447,625,000,000 wei, matching the balance delta exactly

The transaction never exhausted its own limit. `debug_traceTransaction` shows
an out-of-gas five frames deep: each `CALL` forwards 63/64 of what remains, so
the 4.7% headroom between estimate and consumption was gone by the fifth frame.
`eth_call` and `debug_traceCall` with the same input and the same gas limit both
succeed and report `used = 2,075,928`; the 46,165-gas gap is the intrinsic cost
a transaction pays for its 1,700 bytes of calldata and a call does not.
Simulation therefore hides exactly this failure, and `eth_estimateGas` is built
on that simulation, so re-estimating does not help. Nothing reached GenLayer: no
consensus transaction id was ever created.

**2. Signed at 3x the estimate: succeeded.**

    consensus tx : 0xc28d91229bbff8ed42ead1baaff872b8799700a4ac63146b321a1cb03d89cec3
    contract     : 0xCf1C0889Cb6fb0643B36Ef43F178CBa3Bd7582BC
    receipt      : status 5, result 1, txExecutionResult 1, no appeal
    consensus    : 5 validators, 3 initial rotations, leader index 2,
                   5 of 5 votes committed and revealed in round 0
    timing       : Created 1790023938 -> LastVote 1790023947, 9 seconds

Gas is charged on what is used, not on the limit, so the larger limit cost
nothing. `deploy_bradbury.py` now applies that 3x multiplier by default, clamped
to the 2^24 cap, and prints the L2 hash before broadcasting.

`python3 read_bradbury.py trace 0xc28d9122...`:

    result_code : 0
    run_time    : 0s
    stdout      : '{"probe":"tiny","version":"1"}\n'
    stderr      : ''
      kind      : Return
      data      : {'is_init': True, 'probe': 'tiny', 'version': '1'}
      modules   : ['']

`result_code 0` is `return` in the executor's enum. The `modules` line is the
decisive one: a Python contract traces as `['cpython', 'softfloat']`, and this
one carries neither, so a raw WASM module really ran. The module also returned
a value from its init path, which the tls verifier does not do.

## The gas and pubdata findings, and what they exclude

The two ceilings are independent, and the gas cap binds first:

    payload 52,736 bytes   OK, estimates at about 42,000,000 gas
    payload 52,992 bytes   invalid transaction: BlockPubdataLimitReached
    payload 131,072 bytes  bare "execution reverted" with null data
                           (the same wall, reported worse)

Since 52,736 bytes already estimates at roughly 42 million gas and the
per-transaction cap is 16,777,216, the operative deploy limit is about
**20 kB of contract code**, not 52 kB.

What that excludes today:

* `tls-verifier-wasm/verifier.wasm`, 210,488 bytes: four times the pubdata
  ceiling, about fifteen times what the gas cap allows. No SDK can deploy it,
  and no SDK can split it across transactions.
* `contracts/Marketplace.py` v1.4.7, 35,650 bytes: deployed successfully on
  2026-05-21 at block 10,579,477 with gas limit 28,759,916 and 26,619,597 gas
  used, and refused today. The same bytes estimate at 28,902,212 gas, 172.3% of
  the cap. The gas schedule barely moved; the ceiling did. Stripping saves 93
  bytes. v1.5 has to be split across contracts.

Two SDK behaviours make this worse than it needs to be:

* **genlayer-py 0.16.3** signs the raw `eth_estimateGas` result with no
  multiplier and no buffer (`genlayer_py/contracts/actions.py`
  `_prepare_transaction`), which is what produced the reverted transaction
  above.
* **genlayer-js** swallows the estimation revert entirely: on the 210 KB
  payload it logs `Gas estimation failed, using default 200_000` and proceeds
  to broadcast. A deploy that needs 42 million gas sent with a 200,000 gas limit
  spends fees for nothing.

## Files

| file | what it does |
|---|---|
| `REVERT_ANALYSIS.md` | full method and raw sweeps: the revert diagnosis, the pubdata sweep, the tiny crate, the gas cap search, the reverted deploy, the on-chain result, and the Marketplace.py measurement |
| `NOTES.md` | preparation: the verifier artifact and its import set, why the CLI and the tls repo's own deploy script cannot target Bradbury, the RPC methods verified live, and the open risks |
| `deploy_bradbury.py` | builds the `addTransaction` calldata, estimates, refuses anything over the cap, signs at 3x, broadcasts, waits for the L2 receipt, decodes `NewTransaction`. `--estimate-only` stops before signing |
| `diagnose_revert.py` | replays the same `addTransaction` call through `eth_call` instead of `eth_estimateGas` and prints the raw revert data. Sends nothing, needs no key |
| `check_genlayer_js.mjs` | drives the real genlayer-js `deployContract` path through a local guard proxy that forwards reads to Bradbury and refuses `eth_sendRawTransaction`, which is how the swallowed estimation revert and the 200,000 gas fallback were observed |
| `local_run.py` | runs the probe module under wasmtime with a stubbed host, and decodes the captured `gl_call` bytes with genlayer-py's own calldata decoder. This is the check that ran before anything was spent |
| `read_bradbury.py` | `trace <TX>` reads the GenVM trace; `call <ADDRESS>` sends a read |
| `find_l2_tx.py` | binary-searches the block where an account's nonce increments, to recover an L2 hash genlayer-py never printed |
| `gas_cap_search.py` | offers the same signed deploy at successive gas limits with a zero-balance key |
| `size_sweep.py` | sweeps payload size through `eth_estimateGas` to find the pubdata ceiling |
| `estimate_source.py` | estimates the deploy gas for a Python contract source file |
| `strip_source.py` | strips comments, blank lines and docstrings from a contract, preserving the line-1 runner directive and f-string contents, verified by comparing `ast.dump` |
| `tiny-wasm/` | the probe crate: `Cargo.toml`, `src/main.rs` (`no_std`), `src/main_std_reference.rs.txt` (the first `std` build, kept for reference), `strip_exports.py`, and the built `tiny_probe.wasm` |

Three of those scripts point at artifacts that are deliberately not vendored.
`diagnose_revert.py` and `check_genlayer_js.mjs` were both originally run
against `tls-verifier-wasm/verifier.wasm` from
`github.com/genlayerlabs/tls-twitter-bounty`; clone that repository and pass the
path (`WASM_PATH` for the Node script) to reproduce the original reverts.
`local_run.py` defaults to the checked-in `tiny-wasm/tiny_probe.wasm` rather
than to a build under `tiny-wasm/target/`, which is not vendored either.
`check_genlayer_js.mjs` also resolves genlayer-js out of the globally installed
`genlayer` CLI, so its `CLI` path is machine-specific.

## Rebuilding the probe module

Needs `rustup target add wasm32-wasip1` and `cargo install wasm-opt`.

    cd tiny-wasm
    cargo build --release --target wasm32-wasip1
    wasm-opt -Oz -o tiny_probe.wasm target/wasm32-wasip1/release/tiny_probe.wasm
    python3 strip_exports.py tiny_probe.wasm

`strip_exports.py` removes the three export entries Rust adds for the libc
symbols the crate has to define itself under `no_std` (`__wasi_init_tp`,
`__wasm_call_dtors`, `__wasi_proc_exit`); the functions stay, because crt1 calls
them. The result is 1,447 bytes, imports `genlayer_sdk::gl_call` plus five WASI
preview1 functions, exports `memory` / `_start` / `__main_void`, and contains
zero float instructions, which the deterministic engine requires.

## Where this feeds back

`docs/PRIMITIVES_STUDY.md`. Sections B.7 (the gas cap), B.8 (the pubdata
ceiling and the estimation gap), B.9 (the contract size ceiling and what it does
to `Marketplace.py`), F (the WASM verdict) and primitive request 9 all come from
this probe.

## Cleanup

Delete this directory once request 9 is answered and v1.5's contract split is
decided. Nothing else in the repository depends on it.
