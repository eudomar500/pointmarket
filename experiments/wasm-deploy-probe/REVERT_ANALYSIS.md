# Why deploy_bradbury.py reverts at eth_estimateGas

Result: the failure is **not** WASM-specific and **not** fee-related. It is a
size ceiling imposed by the underlying zkSync Elastic Chain L2, hit long before
GenLayer sees the payload. No transaction was sent at any point.

## 1. The revert has no data

Replaying the identical `addTransaction` call through `eth_call` (read-only, no
funds) returns:

    code    : 3
    message : execution reverted
    raw data: None

Both the GenLayer RPC (`https://rpc-bradbury.genlayer.com`) and the L2 chain RPC
(`https://rpc.testnet-chain.genlayer.com`) return the same thing with a null
`data` field, so there is no `Error(string)` payload and no custom-error
selector to decode. The 11 custom errors in the shipped `CONSENSUS_MAIN_ABI_V06`
(`CallerNotMessages`, `CanNotAppeal`, `InvalidDeploymentWithSalt`,
`InvalidGhostContract`, `InvalidInitialization`, `InvalidRevealLeaderData`,
`InvalidVote`, `NotInitializing`, `OwnableInvalidOwner`,
`OwnableUnauthorizedAccount`, `ReentrancyGuardReentrantCall`) are therefore all
ruled out: none of them is being raised.

Reproduce: `python3 diagnose_revert.py`

## 2. Control: the same path with a tiny Python contract PASSES

Identical genlayer-py code path, identical `value = 0`, only the payload
changed. Driven to `eth_estimateGas` and stopped:

    payload            bytes    eth_call         eth_estimateGas
    -----------------  -------  ---------------  ------------------
    python contract      273    OK (0x)          OK  0x172bb1
    raw bytes             32    OK (0x)          OK  0x14b8ed
    verifier.wasm     210488    REVERT           REVERT

So `addTransaction` with `msg.value = 0` does **not** revert on Bradbury. The
fee path and the ABI encoding are both fine, and the earlier "no fee deposit"
risk recorded in NOTES.md is disproven. The consensus contract does not inspect
or reject the code for being WASM either: 32 arbitrary bytes estimate fine.

## 3. The real cause: L2 pubdata limit

Sweeping the payload size with dummy bytes through the same call:

    code bytes   calldata hex chars   result
    ----------   ------------------   ---------------------------------------
        1 024                2 570    OK  gas=0x200fe4
        8 192               16 906    OK  gas=0x739379
       16 384               33 290    OK  gas=0xd5cbf1
       32 768               66 058    OK  gas=0x19552e2
       49 152               98 826    OK  gas=0x25a8263
       51 200              103 ...    OK  gas=0x2707e2f
       52 224                  ...    OK  gas=0x27b5110
       52 736                  ...    OK  gas=0x280c901   <-- largest accepted
       52 992                  ...    invalid transaction: BlockPubdataLimitReached
       65 536              131 594    invalid transaction: BlockPubdataLimitReached
       98 304              197 130    invalid transaction: BlockPubdataLimitReached
      110 592                  ...    invalid transaction: BlockPubdataLimitReached
      126 976                  ...    invalid transaction: BlockPubdataLimitReached
      131 072              262 666    execution reverted    <-- message lost here
      163 840                  ...    execution reverted
      210 488              421 514    execution reverted

Two distinct ceilings, both far below the 210 488-byte verifier:

1. **~52 736 bytes of contract code** is the operative limit. Above it the node
   answers `invalid transaction: BlockPubdataLimitReached`. GenLayer Chain is a
   zkSync Elastic Chain L2; every calldata byte becomes pubdata that must be
   published, and a single transaction cannot exceed what one block can hold.
   This reproduced deterministically across many calls, so it is a hard cap, not
   transient congestion.
2. At exactly **131 072 bytes (128 KiB)** of code and above, the node stops
   returning any message at all and gives the bare `execution reverted` with
   null data. That is the message the original probe saw. It is the same wall,
   just reported less usefully.

Note the gas figures: 52 736 bytes already estimates at `0x280c901`, about
42 million gas. Contract size on this chain is expensive well before the cap.

Reproduce: the sweep script is inline in this document's method; see
`diagnose_revert.py` for the calldata construction it reuses.

## 4. genlayer-js does not get further, and would waste funds

`check_genlayer_js.mjs` drives the real `genlayer-js` `deployContract` path (the
SDK the CLI uses, and the one that deployed a Python contract to Bradbury this
morning) through a local guard proxy that forwards reads to Bradbury but refuses
`eth_sendRawTransaction`. Result:

    --- python-tiny (273 bytes) ---
      ESTIMATION PASSED, blocked at broadcast by the proxy

    --- wasm-210KB (210488 bytes) ---
      GenLayer RPC error (eth_estimateGas): execution reverted
      Gas estimation failed, using default 200_000: UnknownRpcError ...
      ESTIMATION PASSED, blocked at broadcast by the proxy

genlayer-js hits the **identical** estimation revert. The difference is that it
does not stop: it swallows the failure, substitutes a hardcoded 200 000 gas
limit, and proceeds to broadcast. A successful 52 KB deploy estimates at roughly
42 million gas, so a 210 KB deploy sent with 200 000 gas cannot succeed; it would
be rejected or run out of gas, spending fees for nothing. The guard proxy is the
only reason nothing was sent.

Useful side fact: `genlayer-js` types `code` as `string | Uint8Array`
(`dist/index-C3Ul1Rte.d.ts:2859`), so the SDK handles binary fine. The CLI's
inability to deploy a `.wasm` is the CLI's own `readFileSync(path, "utf-8")`
(NOTES.md section 3), not an SDK limitation.

## 5. Consequence

The 210 KB `verifier.wasm` cannot be deployed to Bradbury in a single
transaction by any SDK. The ceiling is roughly **52 KB of contract code**, and it
belongs to the L2, not to GenVM or the consensus contracts.

The original question -- does Bradbury accept a WASM contract at all? -- is
therefore still open, and is now cheap to answer: deploy a **small** WASM module
(a few KB) rather than this one. If a minimal WASM contract deploys and executes,
WASM support is confirmed and the verifier's size is a separate, quantified
problem. Building such a module needs the `wasm32-wasip1` Rust target, which is
not installed here.

---

# Tiny WASM probe

Purpose: answer the original question -- does Bradbury load and execute a raw
WASM contract? -- with a module far below the ~52 KB ceiling measured above,
so that a failure means "WASM is not supported" and not "the payload was too
big".

## The crate

`tiny-wasm/` is a single-file Rust crate, `src/main.rs`, built for
`wasm32-wasip1`. It deliberately mirrors the proven tls verifier's module shape
so that a failure cannot be blamed on an unusual build:

* imports `genlayer_sdk::gl_call` with the wasm type `(i32,i32,i32) -> (i32)`,
  which is the same type the pinned CPython runner imports;
* is a wasi-libc command module driven through `_start`, exporting
  `memory`, `_start`, `__main_void`;
* ends up with an import set identical to `verifier.wasm`:
  `genlayer_sdk::gl_call` plus `wasi_snapshot_preview1::{fd_read, fd_write,
  environ_get, environ_sizes_get, proc_exit}`.

What it does:

1. reads the ExtendedMessage from stdin and scans it for the `is_init` field;
2. writes `{"probe":"tiny","version":"1"}` and a newline to stdout;
3. calls `gl_call` with the calldata-encoded message
   `{"Return": {"is_init": <bool>, "probe": "tiny", "version": "1"}}`;
4. if `gl_call` ever returns, writes `gl_call returned unexpectedly, code=<n>`
   to stderr and exits 1, so a refused Return cannot be mistaken for success.

It uses no heap and calls WASI preview1 directly rather than through
`std::io`, which is most of the size saving.

### Returning from a deployment is correct, and the verifier does not do it

The tls verifier's init path prints and calls `exit(0)`, never returning a
value. That is the anomaly, not the rule. The reference Python runner returns on
init: `_genlayer_runner.py` `_handle_main()` ends in `_give_result(...)`, which
calls `gl_call.contract_return(res)` and emits `{"Return": <value>}` even when
the constructor produced `None`. A raw WASM module can do the same, because the
message is only calldata. This probe therefore returns, and the returned value
is visible in the trace.

## Determinism and feature constraints, checked against the executor source

`genvm-executor` `executor/src/rt/supervisor/mod.rs:87-118` is the authoritative
list, and it differs from the GenVM constraints note committed in the tls
repo (`github.com/genlayerlabs/tls-twitter-bounty`):

* `wasm_bulk_memory(true)` and `WasmFeatures::BULK_MEMORY, true` -- bulk memory
  IS enabled. This matters: the probe emits `memory.fill` / `memory.copy`, which
  `verifier.wasm` does not, so it had to be confirmed rather than assumed.
* `wasm_simd(true)`, `wasm_relaxed_simd(false)`, `relaxed_simd_deterministic(true)`.
* `wasm_tail_call(true)`, SIGN_EXTENSION, MUTABLE_GLOBAL, MULTI_VALUE enabled.
* `SATURATING_FLOAT_TO_INT` is set false and then set true again on the very next
  line, and the `REFERENCE_TYPES, false` line is commented out. In this executor
  version both are in fact allowed. That note, which says they are disabled,
  describes an older executor.
* The deterministic engine sets `wasm_floats_enabled(false)`. The probe contains
  **0 float instructions** (checked by disassembling with wasm-opt and grepping
  for `f32.`/`f64.`; `verifier.wasm` also has 0).

The module validates under wasmtime configured with GenVM's own feature set.

## Size

The first build was `std`, and it worked, but it was too big to deploy: at
26 685 bytes it estimated at ~21.9M gas, over the per-transaction cap found
below. It was rebuilt `#![no_std]`, with no allocator and direct WASI calls.

| stage | bytes |
| --- | ---: |
| std build, after `wasm-opt -Oz` (not kept here; rebuildable from `tiny-wasm/src/main_std_reference.rs.txt`) | 26 685 |
| no_std `cargo build --release` | 1 778 |
| after `wasm-opt -Oz` | 1 503 |
| after `strip_exports.py` (see below) | **1 447** |

Two details the no_std rebuild forced, both recorded in `tiny-wasm/src/main.rs`:

* **Entry point.** A hand-written `_start` collides with the one in wasi-libc's
  `crt1-command.o`, and rust-lld is invoked directly so there is no
  `-nostartfiles` to drop that object. Taking over `__main_void` instead gets
  the same result: it is the first code of ours that runs, and the export list
  stays `memory` / `_start` / `__main_void`, exactly as in the std build and in
  `verifier.wasm`.
* **Three libc symbols.** `crt1-command.o` references `__wasi_init_tp`,
  `__wasm_call_dtors` and `__wasi_proc_exit`, which normally come from the rest
  of wasi-libc. Under `no_std` that is absent, and the linker turned them into
  imports from a phantom `env` module, which would have broken linking inside
  GenVM and changed the import set. They are defined in the crate instead. Rust
  then exported them too, so `strip_exports.py` removes those three export
  entries; the functions stay, because crt1 calls them.

The result has the intended surface exactly:

* imports: `genlayer_sdk::gl_call` plus `wasi_snapshot_preview1::{fd_read,
  fd_write, environ_get, environ_sizes_get, proc_exit}` -- the same six as the
  std build and as `verifier.wasm`;
* exports: `memory`, `_start`, `__main_void`;
* 0 float instructions;
* validates under wasmtime configured with GenVM's own feature set.

Building needed `rustup target add wasm32-wasip1` and `cargo install wasm-opt`;
nothing else was installed.

## Verified locally before spending anything

`local_run.py` runs the module under wasmtime with a stubbed host that feeds a
synthetic ExtendedMessage on stdin and captures the `gl_call` bytes. The
captured message is decoded with genlayer-py's own calldata decoder, which is
independent of the encoder in the crate:

    stdout      : b'{"probe":"tiny","version":"1"}\n'
    stderr      : b''
    gl_call len : 39 bytes
    gl_call hex : 0e0652657475726e1e0769735f696e6974100570726f62652474696e790776657273696f6e0c31
    decoded     : {'Return': {'is_init': True, 'probe': 'tiny', 'version': '1'}}
    VERDICT     : PASS

This proves the module and its calldata encoding. It does not prove Bradbury
accepts WASM; that is what the deploy is for.

## The per-transaction gas cap

The std build's deploy passed `eth_estimateGas` at 21 881 929 and was then
refused at `eth_sendRawTransaction` with `gas limit too high` (code -32602).
Nothing was sent; the transaction is absent from both
`rpc-bradbury.genlayer.com` and `rpc.testnet-chain.genlayer.com`.

**genlayer-py does not overshoot.** `contracts/actions.py` `_prepare_transaction`
ends with

    transaction["gas"] = self.provider.make_request(
        "eth_estimateGas", params=[transaction]
    )["result"]

and `_send_transaction` signs that dict as-is. There is no multiplier and no
buffer: the signed gas limit is exactly the estimate.

The cap is not the block limit, which is 100 000 000. `zks_getFeeParams` is not
exposed on this node, so it was measured directly by `gas_cap_search.py`: sign
the same deploy with a freshly generated key that holds zero balance, and offer
it to `eth_sendRawTransaction` at different gas limits. Validation happens
before execution, so the node answers without charging, and an empty account
cannot have anything mined even if every other check passed.

    gas = 16 777 215 (2^24-1)   accepted, stopped later by "sender does not have"
    gas = 16 777 216 (2^24)     accepted, stopped later by "sender does not have"
    gas = 16 777 217 (2^24+1)   gas limit too high
    gas = 16 777 218 (2^24+2)   gas limit too high

**The cap is exactly 2^24 = 16 777 216 gas per transaction.**

For scale, the Python contract deploy that succeeded, GenLayer transaction
`0x97506d7b...`, carried 9 623 bytes of `txCallData` and needs 8 645 294 gas
when replayed through `eth_estimateGas` today: about half the cap. (Its L2
transaction hash is not exposed by `gen_getTransactionReceipt`, so the gas was
obtained by re-estimating its recorded calldata rather than from an L2 receipt.)

Deploy gas is dominated by calldata, so the cap translates into a size limit
tighter than the 52 736-byte pubdata ceiling:

    26 685 bytes -> 21 917 365 gas   over cap
    24 000 bytes -> 19 893 595 gas   over cap
    20 000 bytes -> 16 803 816 gas   over cap
    18 000 bytes -> 15 247 074 gas   fits
    12 000 bytes -> 10 470 360 gas   fits
     8 000 bytes ->  7 428 360 gas   fits

The binding limit for a contract deploy on Bradbury is therefore about
**20 kB of contract code**, not 52 kB.

`deploy_bradbury.py` now estimates and compares against the cap before signing
anything, and refuses rather than producing a transaction the node will reject.

## Estimation on Bradbury

    python3 deploy_bradbury.py tiny_probe.wasm --estimate-only

    wasm size    : 1447 bytes
    to           : 0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D (ConsensusMain)
    calldata     : 3402 hex chars
    ESTIMATED GAS: 0x24a9c9 (2,402,761)
    per-tx cap   : 16,777,216 (2^24), this uses 14.3%
    nothing was sent

Estimation passes with a wide margin, where the 210 KB verifier reverted
outright and the 26 KB std build was over the gas cap. Nothing was sent.

## What to expect from the trace

On success, `python3 read_bradbury.py trace <TX_HASH>` should print:

    result_code : 0
    stdout      : '{"probe":"tiny","version":"1"}\n'
    stderr      : ''
      kind      : Return
      data      : {'is_init': True, 'probe': 'tiny', 'version': '1'}
      modules   : [<the contract module>]

`result_code` comes from the `result_code` enum in the executor's
`public-abi.json`: `return=0, user_error=1, vm_error=2, internal_error=3`.
The `modules` line is the strongest single tell: a Python contract shows
`['cpython', 'softfloat']`, so anything else means a raw WASM module really ran.

Failure modes, and how each looks:

| what happened | result_code | stdout | return_data |
| --- | --- | --- | --- |
| module rejected before it ran | 2 | empty | `invalid_contract`, or `invalid_contract wasm validating` / `linking` / `entrypoint` |
| `gl_call` not linked for raw WASM | 2 | empty | `invalid_contract wasm linking` |
| module ran, host refused the Return | 2 | the marker line | `exit_code 1`, with stderr `gl_call returned unexpectedly, code=<n>` |
| ran out of time or memory | 2 | possibly the marker | `timeout` or an `OOM` variant |

The third row is the reason the probe writes that stderr line: it separates
"WASM does not run here" from "WASM runs but a raw module cannot return".

## First real deploy attempt: reverted out of gas

Run of 2026-09-21. Estimation passed at 2 222 870 gas, the transaction was
broadcast, and genlayer-py then raised `GenLayerError("Transaction failed")`
without printing a hash.

**What that error means.** `contracts/actions.py` `_send_transaction`:

    tx_receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)

    if tx_receipt.status != 1:
        raise GenLayerError("Transaction failed")

So the L2 receipt did arrive and its status was 0. It is not a timeout: a
timeout would surface as web3's `TimeExhausted` from the line above. The L2
hash is never printed, which is why the transaction had to be hunted down.

**Finding it.** `find_l2_tx.py` binary-searches the block at which the account's
nonce increments, about 20 RPC calls instead of scanning thousands of blocks:

    L2 HASH   : 0xd6255f352501dcc102869c201dce91c901fb2e40c354d54428cbc19271b8848e
    block     : 22 498 212, nonce 287
    gas limit : 2 222 870
    gasUsed   : 2 122 093
    gasPrice  : 2 125 000 000 wei
    cost      : 4 509 447 625 000 000 wei
    status    : 0 (REVERTED), 0 logs

That cost matches the account balance delta exactly
(19 366 868 287 099 198 350 -> 19 362 358 839 474 198 350), so this transaction
is the only thing that was spent. No `NewTransaction` event was emitted, so no
consensus transaction id exists and nothing reached GenLayer.

**Why it reverted.** There is no revert reason: `debug_traceTransaction` with
the call tracer shows the failure is an out-of-gas five frames deep.

    CALL ConsensusMain            gas 2 179 266  used 2 078 489  execution reverted
      DELEGATECALL implementation gas 2 140 076  used 2 073 229  execution reverted
        ...
          CALL 0x1d301ace...      gas 1 406 893  used 1 276 760   <- eats most of it
          CALL 0x4a0887ea...      gas   146 743  used    70 218
          CALL 0x55534b80...      gas    49 671  used    48 941  execution reverted
            DELEGATECALL          gas    48 486  used    48 486  out of gas

The transaction never exhausted its own limit: it used 2 122 093 of 2 222 870.
Each `CALL` forwards only 63/64 of the gas remaining at that level, so by the
fifth frame the 4.7% margin between estimate and actual consumption had shrunk
to nothing.

**Why simulation did not predict it.** `eth_call` and `debug_traceCall` with the
same input and the same gas limit, at the parent block and at the tip, both
succeed and report `used = 2 075 928` with no out-of-gas. The gap to the real
2 122 093 is 46 165, which is the intrinsic cost a transaction pays for 1 700
bytes of calldata and a call does not. Simulation therefore hands the nested
frames more gas than the real transaction has, and hides exactly this failure.
`eth_estimateGas` is built on the same simulation and returns 2 222 870 both
before and after the failure, so re-estimating does not help.

**The fix.** `deploy_bradbury.py` no longer delegates to
`client.deploy_contract`. It now builds the same calldata, signs with
`GAS_MULTIPLIER` (3) times the estimate, clamped to the 2^24 cap, prints the L2
hash *before* broadcasting, waits for the L2 receipt and reports status and
gasUsed, and only then decodes the `NewTransaction` event for the consensus id.
Gas is charged on what is used, not on the limit, so the larger limit costs
nothing on success: 3x the current estimate is 6 668 610, which is 39.7% of the
cap.

## On-chain result

The retry, signed at 3x the estimate, succeeded.

* consensus tx: `0xc28d91229bbff8ed42ead1baaff872b8799700a4ac63146b321a1cb03d89cec3`
* contract address: `0xCf1C0889Cb6fb0643B36Ef43F178CBa3Bd7582BC`
* sender: `0xf27e3a6d7bf4bfc0a837020fd74e73055af17d53`, 5 validators, 3 initial
  rotations, leader index 2, 5 of 5 votes committed and revealed, round 0
* receipt: `status 5`, `result 1`, `txExecutionResult 1`, no appeal
* time to decided: `Created 1790023938` to `LastVote 1790023947`, 9 seconds,
  with no leader rotation. Much faster than the 20-25 minutes the tracking
  probe saw on its writes.

`gen_dbg_traceTransaction` (`python3 read_bradbury.py trace 0xc28d9122...`):

    result_code : 0
    run_time    : 0s
    stdout      : '{"probe":"tiny","version":"1"}\n'
    stderr      : ''
    return_data : 3426 hex chars
      kind      : Return
      data      : {'is_init': True, 'probe': 'tiny', 'version': '1'}
      modules   : ['']

Every row of the failure table above is excluded: `result_code` is 0 and not 2,
stdout carries the marker line, the Return was accepted rather than refused,
and `modules` contains no `cpython` and no `softfloat`, which is what a Python
contract traces as.

**Verdict: Bradbury loads and executes raw WASM contracts.** A raw module can
also return a value from its init path, which the tls verifier does not do. The
open question from section 5 is therefore answered, and the remaining obstacle
for the 210 KB verifier is purely size: it is over the pubdata ceiling of
section 3 and far over the gas cap measured above.

---

# Marketplace.py cannot be redeployed today, and that is new

Measured 2026-09-21 with `estimate_source.py`, which drives the same genlayer-py
calldata path as `deploy_bradbury.py` with a throwaway key and stops at
`eth_estimateGas`. Nothing was sent.

| source | bytes | txCallData | addTransaction | estimated gas | vs 2^24 cap |
| --- | ---: | ---: | ---: | ---: | ---: |
| `contracts/Marketplace.py` as-is | 35 650 | 35 658 | 35 908 | 28 902 212 | **172.3%** |
| same, comments/blanks/docstrings stripped | 35 557 | 35 565 | 35 812 | 28 834 031 | **171.9%** |

## Stripping is not a lever here

The contract has **no docstrings, no multi-line string literals other than one
f-string, and exactly one comment** -- the runner directive on line 1, which
must survive or GenVM rejects the contract with `invalid_contract
absent_runner_comment`. The only removable content is 100 blank lines, and 7 of
those sit *inside* the multi-line f-string that builds the dispute prompt, so
they are part of the text the model is shown and were kept.

Net: 93 bytes removed, 68 181 gas saved, still 172% of the cap. At roughly
730 gas per byte of source, closing a 12 million gas gap would mean deleting
about 16 kB of real code.

`strip_source.py` does the stripping. Two traps it has to handle, both of which
silently corrupted the first attempt:

* the line-1 runner directive is a comment that cannot be stripped;
* since Python 3.12 an f-string is not a single `STRING` token but a run of
  `FSTRING_START`/`MIDDLE`/`END` tokens, so a tokenize-based guard does not see
  it. The blank lines inside the dispute prompt were removed, changing the
  prompt. The guard is now built from the AST instead. The output is verified by
  comparing `ast.dump` of both files, and it passes `genvm-lint`.

## The contract on chain is byte-identical, and its deploy would be refused now

`gen_getContractCode` for `0x68546F0a8d2Af91d5917A03245c1D31296487b3F` returns
35 650 bytes with sha256 `d073f43c2291f713d953f5eb9092f044`, byte-identical to
the repository's `contracts/Marketplace.py`, `CONTRACT_VERSION = 147`.

Its deployment was found by binary-searching `eth_getCode` at the ghost address
for the block where code first appears: block 10 579 477, 2026-05-21 14:38:16Z.

    L2 hash    : 0xe98d95cbc014547bb3dde5912083528ed038e18a146e1fd4cdea09540b5c0d6c
    from       : 0xf27e3a6d... (the same deployer)
    to         : ConsensusMain
    selector   : 0xe71d5196 addTransaction
    _recipient : 0x0 (deploy), 5 validators, 3 max rotations
    txCallData : 35 658 bytes -> RLP[code 35 650 bytes, ctor 0x06, leaderOnly 0]
    gas limit  : 28 759 916
    gas used   : 26 619 597
    gas price  : 144 242 100 wei
    cost       : 3 839 666 572 433 700 wei (0.003840 GEN)
    status     : 1 (success)

That gas limit is **171.4% of today's 2^24 cap**, and the gas actually consumed
was 158.7% of it. The same transaction submitted today would be refused at
`eth_sendRawTransaction` with `gas limit too high` before it reached execution.

The gas schedule has barely moved: 26 619 597 used in May against 28 902 212
estimated now for the same payload. What changed is the ceiling. A 35 kB
contract was deployable on Bradbury in May and is not deployable in September,
and nothing about the contract changed.

Practical consequence: the deployed v1.4.7 marketplace cannot be redeployed or
upgraded by redeploy on Bradbury as it stands. Anything going out now has to fit
under roughly 20 kB of source, which for this contract means splitting it across
contracts rather than editing comments.
