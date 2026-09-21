# WASM deployment probe: prepared, not executed

Goal: answer empirically whether Testnet Bradbury accepts a raw WASM contract.

## 1. Artifact

A prebuilt verifier is committed in `github.com/genlayerlabs/tls-twitter-bounty`,
so nothing needs building. That repository is not vendored here; it was cloned
out of tree for this probe and is referenced by URL.

    tls-twitter-bounty/tls-verifier-wasm/verifier.wasm   210488 bytes
    file(1): WebAssembly (wasm) binary module version 0x1 (MVP)

Committed by `08f272e` (2026-01-16), "Fix WASM verifier deployment - remove
float saturation instructions ... Verifier now deploys successfully to GenVM."
That commit also added a GenVM constraints note to the repo:
SATURATING_FLOAT_TO_INT disabled, REFERENCE_TYPES disabled, SIMD disabled.

Rust 1.95.0 and cargo are installed, but `rustup target list --installed`
reports only `x86_64-unknown-linux-gnu`. The `wasm32-wasip1` target is NOT
installed, and neither is `wasm-opt`. Neither is needed, because the prebuilt
artifact is used. Nothing was installed.

### Checks run on the artifact

* Import section (parsed directly):

      wasi_snapshot_preview1 :: fd_write, fd_read, environ_get,
                                environ_sizes_get, proc_exit
      genlayer_sdk          :: gl_call   (i32,i32,i32) -> (i32)

  All five WASI functions are also imported by the pinned CPython runner that
  GenLayer's Python contracts use, so GenVM's WASI surface provides them. The
  `gl_call` signature is byte-for-byte the same type as the one CPython's
  runner imports, so the host ABI matches.

* Exports: `memory`, `_start`, `__main_void`. Standard wasip1 command module.

* Validates under wasmtime with `wasm_reference_types=False` and
  `wasm_simd=False`. Saturating-float-to-int is not separately configurable in
  the wasmtime Python bindings, so that one rests on the commit message rather
  than on a local check.

## 2. Why the repo's own deploy script cannot be used

`deploy_wasm.py:49-59` posts an UNSIGNED `gen_call` with `"type": "deploy"` and
a `from` address it does not control, to `http://localhost:4000/api`. Studio
simulates the consensus pipeline and does not verify signatures. Bradbury does:
a deployment there is a signed EVM transaction calling `addTransaction` on
ConsensusMain, submitted through `eth_sendRawTransaction`. The script has no
signing path at all, so it cannot be pointed at Bradbury by changing the URL.

`deploy_wasm.mjs` has the right shape (genlayer-js `deployContract({code})`) but
hardcodes a well-known test private key and the Studio endpoint.

## 3. Deployment path chosen: genlayer-py, not the CLI

The CLI (`genlayer` 0.39.1) cannot deploy a `.wasm`. Evidence, from its own
source at
`~/.nvm/versions/node/v24.10.0/lib/node_modules/genlayer/src/commands/contracts/deploy.ts:25-30`:

    private readContractCode(contractPath: string): string {
      if (!fs.existsSync(contractPath)) {
        throw new Error(`Contract file not found: ${contractPath}`);
      }
      return fs.readFileSync(contractPath, "utf-8");
    }

The file is read as a UTF-8 *string* and handed to `deployContract({code: ...})`
at line 135. Measured on this exact artifact:

    raw bytes         : 210488
    utf-8 string len  : 209891
    re-encoded bytes  : 243600
    byte-identical    : false
    U+FFFD count      : 16625

Every invalid UTF-8 sequence becomes U+FFFD, so the deployed bytes would be a
different, invalid module. There is no `--binary` or similar flag.

genlayer-py 0.16.3 does accept binary code:
`genlayer_py/contracts/actions.py:132-134`, `def deploy_contract(self, code:
Union[str, bytes], ...)`, and `abi/transactions.py:serialize` is `rlp.encode`,
which encodes `bytes` as a byte string. The RLP payload is
`[code, calldata, leader_only]`, the same shape as the repo's `deploy_wasm.py`.

Install location: genlayer-py is NOT in a virtualenv under
`~/proyectos/genlayer-p2p-arena` (that repo has no venv; `requirements.txt`
only lists `genlayer-py>=0.1.0`). It is a user-level install at
`~/.local/lib/python3.12/site-packages/genlayer_py`, version 0.16.3, and the
system `python3` picks it up directly.

Bradbury is a first-class preset: `genlayer_py/chains/testnet_bradbury.py`
carries `id=4221`, `https://rpc-bradbury.genlayer.com`, and the v0.6 consensus
contract addresses.

## 4. The contract has no view method

`tls-verifier-wasm/src/main.rs` ignores the method name entirely. It parses the
`ExtendedMessage` from stdin for `entry_data` and `is_init`, then:

* `is_init == true` (deployment): prints `{"deployed":true,"version":"0.1.0"}`
  to stdout and `exit(0)` (lines 282-285). It never calls `gl_call` with a
  `Return`.
* otherwise: takes `args[0]` as bytes and runs `verify_proof` (lines 287-310).

`verify_proof` in `src/lib.rs:61-86` returns either `Ok(VerifyResult{valid:
true, ...})` or `Err(String)`. There is no code path that produces
`valid: false`. In `main.rs:308-310` the `Err` is propagated with `?` out of
`main`, which exits non-zero. So a deliberately invalid proof CRASHES the
contract; it does not return false. Flagged rather than worked around.

The cheapest honest proof of execution is therefore the deploy transaction's own
GenVM trace, not a follow-up call.

## 5. RPC methods verified live on Bradbury

* `gen_dbg_traceTransaction` exists and returns `result_code`, `stdout`,
  `stderr`, `return_data`, `genvm_log`, `run_time`, `eq_outputs`. Confirmed
  against a real transaction hash.
* `gen_call` with `"type": "read"` exists (an empty `data` field returns
  `failed to decode tx data: EOF`, i.e. the method is live and validating).
* The RPC edge answers HTTP 403 to urllib's default User-Agent; `read_bradbury.py`
  sends an explicit one.

## 6. Open risks, flagged not guessed

1. ~~**No fee deposit.**~~ DISPROVEN 2026-09-21. A 273-byte Python contract
   estimates fine through the identical genlayer-py path with `msg.value = 0`,
   so `addTransaction` does not require a fee deposit on Bradbury today.
   genlayer-js sends no value for a deploy either. See REVERT_ANALYSIS.md.
   **Replaced by the real blocker: payload size.** Bradbury refuses contract
   code above about 52736 bytes with `invalid transaction:
   BlockPubdataLimitReached`, a zkSync Elastic Chain L2 limit. The 210488-byte
   verifier is four times over it and cannot be deployed in one transaction by
   any SDK.
2. **Exit without Return on the init path.** The verifier exits 0 during
   deployment without calling `gl_call({"Return": ...})`. The commit message
   claims this deploys successfully on GenVM, but that was observed on Studio.
   Whether the Bradbury executor treats a zero-exit-without-Return deployment as
   a valid contract is exactly what this probe measures.
3. **No contract schema.** `gen_getContractSchema` is localnet-only in
   genlayer-py (`contracts/actions.py:25-35` raises "Contract schema is not
   supported on this network"), and the WASM does not implement `#get-schema`
   anyway. Tooling that expects a schema will not work against this contract.
4. **Consensus timing.** A prior probe on Bradbury took 20-25 minutes per write
   with leader rotations and idle-validator replacements. `deploy_bradbury.py`
   polls for 40 minutes; the defaults in genlayer-py are 30 seconds.
5. **Size.** 210 KB of contract code in one transaction. No byte ceiling was
   found in GenVM itself, but the chain-level limit is UNVERIFIED, and this is
   far larger than a typical Python contract.
