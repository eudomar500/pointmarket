# GenLayer runtime primitives: what exists today, and what a trust-minimized physical-goods escrow would still need

Date: 2026-09-21.

Pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
(the pin carried by `contracts/Marketplace.py:1`), which resolves to
`py-lib-genlayer-std:11rhn002yfajawsz7fai6mykznbxkxs6l91iskj5cm82c92qhy3v` and
`cpython:1bk9g3zgym0rrpd9lk584cxfaa4rg0cz36w6xhzkqdj1m2p4xa9n`.

Method. The pinned SDK source was read line by line and compared against the
SDK shipped on current main; the GenVM executor and the GenVM manager sources
were read for the host side of every call the SDK makes; the pinned
`cpython.det.wasm` was extracted from its runner tar and executed directly
under a stock `wasmtime` host, so every module list, import list and timing in
section B is measured output from the interpreter a validator actually runs and
not inference; the public Bradbury RPC was queried live for receipts, calldata,
contract code and execution traces; and two on-chain probes were run, the
carrier tracking probe recorded in `experiments/tracking-probe/README.md` and
the WASM deployment probe recorded in `experiments/wasm-deploy-probe/README.md`.

Every claim below is tagged with the artifact it came from. Claims sourced from
documentation rather than from code or from a live system are tagged DOCS-ONLY.
Claims that could not be established from a primary source are tagged
UNVERIFIED.

--------------------------------------------------------------------------------
## 0. What was inspected, and the version map

### 0.1 The pin in this repository

`contracts/Marketplace.py:1` and `experiments/tracking-probe/tracking_probe.py:1`
both pin:

    # { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

That runner is present, unpacked, in this machine's GenVM caches. Its manifest:

    /home/van/.cache/gltest-direct/extracted/v0.2.16/py-genlayer/
      1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6/runner.json

    {"Seq":[
      {"With":{"action":{"MapFile":{"file":"file","to":"/contract.py"}},"runner":"<contract>"}},
      {"SetArgs":["py","-u","-B","/py/libs/_genlayer_runner.py"]},
      {"Depends":"py-lib-cloudpickle:1dlk6mnfabi0z7r39635amyfzw8xb6rm8bv4pmgv6ji1bfx9hghd"},
      {"Depends":"py-lib-genlayer-std:11rhn002yfajawsz7fai6mykznbxkxs6l91iskj5cm82c92qhy3v"},
      {"Depends":"cpython:1bk9g3zgym0rrpd9lk584cxfaa4rg0cz36w6xhzkqdj1m2p4xa9n"}]}

So "the pinned runner" means exactly three artifacts:

| component | hash | local path |
|---|---|---|
| py-genlayer | `1jb45aa8...jpz09h6` | `~/.cache/gltest-direct/extracted/v0.2.16/py-genlayer/1jb45.../runner.json` |
| py-lib-genlayer-std (the SDK) | `11rhn002...2qhy3v` | `~/.cache/gltest-direct/extracted/v0.2.16/py-lib-genlayer-std/11rhn.../genlayer/` |
| cpython (the interpreter + stdlib) | `1bk9g3zg...2p4xa9n` | `~/.cache/gltest-direct/trees-v2/v0.6.0-rc5/executor/v0.2.17/legacy-runners/cpython/1b/k9g3....tar` |

The same `py-genlayer:1jb45aa8...` hash is listed in the release indexes of
GenVM `v0.2.16` and `v0.3.0-rc7`, and is carried forward into the `v0.6.0-rc5`
bundle under `executor/v0.2.17/legacy-runners/py-genlayer/1j/b45aa8....tar`
(source: `~/.cache/genvm-linter/genvm-universal-*.index*.json`). The pin is
therefore the long-lived "stable" runner, still shipped by the v0.6 stack as a
legacy runner, not a dead version.

The SDK source for this pin is browsable upstream at tag `v0.2.16` of
`genlayerlabs/genvm` under `runners/genlayer-py-std/src/genlayer/gl/`
(verified: `.../gl/nondet/web.py` 3156 bytes, `.../gl/eq_principle.py` 4144
bytes, `.../gl/vm.py` 7717 bytes, `.../gl/genvm_contracts.py` 17019 bytes at
that tag). The repository's `main` branch has since been restructured (the
`gl/` layer was flattened), so `main` paths do NOT correspond to the pin.

### 0.2 "Current main"

| component | identity |
|---|---|
| SDK | `py-lib-genlayer-std:kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0`, shipped in `genvm-universal-v0.6.0-rc5` / `genvm-manager-v0.6.0-rc3`; local copy at `~/.cache/gltest-direct/extracted/local/py-lib-genlayer-std/kzr02.../genlayer/` |
| runner | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |
| manager / modules | `github.com/genlayerlabs/genvm-manager` @ `89c20400f77b647b0e7649f58be0212a4bd6f004` (2026-09-18), "feat(fees): charge LLM tokens and permit deploy balance fees" |
| executor | `github.com/genlayerlabs/genvm-executor`, branches `v0.2.x` and `v0.3.x`; `v0.3.x` head `acb37c7bf7b1e6d9fbfe004414a93fb6306135c0`, `manifest.json` says `"executor-version": "v0.3.0-rc7"` |
| old monorepo | `github.com/genlayerlabs/genvm` (description: "moved to https://github.com/genlayerlabs/genvm-manager"), last push 2026-07-21 |

### 0.3 Method note: the interpreter was actually executed

For section B the pinned `cpython.det.wasm` was extracted from the pinned
cpython runner tar and executed directly under a stock `wasmtime` host (Python
bindings, in a throwaway virtualenv outside this repository) with the runner's
own `/py/std` and `/py/libs` trees mounted, its `genlayer_sdk` imports stubbed
and its `softfloat` imports implemented. Every number and module list in
section B is measured output from that binary, not inference. Timings come from
a stock wasmtime JIT and are indicative of, not identical to, a validator's
configuration.

`gltest.direct` cannot be used for this: it "runs contracts directly in Python
without WASM/simulator" (`gltest/direct/__init__.py:1-4` in
`genlayer-test 0.29.2`), so it reports the host interpreter's capabilities, not
the runner's.

--------------------------------------------------------------------------------
## A. Non-determinism and consensus

### A.1 `gl.nondet.web.render` -- EXISTS (PARTIAL on headers)

Pinned SDK, `genlayer/gl/nondet/web.py:111-160`:

    def render(url, *, mode: Literal['html','text','screenshot'] = 'text',
               wait_after_loaded: str | None = None) -> str | Image

sent to the host as `{'WebRender': {'url', 'mode', 'wait_after_loaded'}}`
(lines 151-159). `wait_after_loaded` is a duration string such as `"1000ms"` or
`"1s"` and defaults to `'0ms'`. `mode='screenshot'` returns
`Image(raw: bytes, pil: PIL.Image.Image)`.

* Custom headers: NOT SUPPORTED. There is no header field in the payload, in
  the pinned SDK or in current main. Current main renames the field to
  `post_load_wait` (`kzr02.../genlayer/nondet/web.py:203-247`) but adds no
  headers.
* User agent: NOT SETTABLE from the contract.
* `render` is refused in deterministic mode: `executor/src/wasi/genlayer_sdk.rs:732-735`
  at tag `v0.2.16` returns `Errno::Forbidden` when
  `self.context.data.conf.is_deterministic`.

Host side (`genlayerlabs/genvm-manager`):

* The sidecar is a puppeteer/Chrome server, `webdriver/src/prj/src/index.ts`.
  Page load timeout defaults to `30000` ms and `waitUntil` defaults to
  `domcontentloaded` (`index.ts:168-177`).
* `wait_after_loaded` is clamped server-side to `web.max_wait_after_loaded`,
  default 60s (`docs/schemas/default-config.json`, `web.max_wait_after_loaded`:
  "upper bound for `post_load_wait` requested by contracts; larger values are
  clamped (with a warning). Defaults to 60s"; enforcement at
  `implementation/src/web/handler.rs:58-69`).
* Size limit: in executor `v0.3.x` a render requires at least
  `WEB_RENDER_MIN_SPACE = 134217728` (128 MiB) of remaining VM memory or the VM
  is OOM-killed, and the response body cap handed to the module is
  `remaining_memory * 3 / 4` (`executor/src/wasi/genlayer_sdk.rs:1120-1152`;
  constant at `executor/crates/sdk-rs/src/abi/consts.rs:175` and
  `executor/codegen/data/public-abi.json:58-68`). At tag `v0.2.16` this check
  and cap do not exist (`genlayer_sdk.rs:732-740` sends the render with no size
  argument), so the cap is a `v0.2.17`+ addition.
* A page that answers a non-2xx (and non-304) status becomes a non-fatal
  `WEBPAGE_LOAD_FAILED` user error carrying `url`, `status`, `body`
  (`install/config/genvm-web-default.lua:4-6, 50-62`). A sidecar failure is
  deliberately fatal, `WEBDRIVER_UNAVAILABLE`, and the validator abstains
  (`install/lib/genvm-lua/lib-web.lua:124-151`).

The repository's own probe already measured what this means for carriers.
`experiments/tracking-probe/README.md` records a run of 2026-09-21 on Testnet
Bradbury against contract `0xaAc9b4246742afa2937BC119e0e936060fcbbc5A`, with
`wait_after_loaded="5000ms"` on every call:

| carrier | outcome | `raw_length` | probe tx |
|---|---|---|---|
| ups | `NondetException WEBPAGE_LOAD_FAILED`, `net::ERR_ABORTED`, HTTP 418 | 0 | `0x75d404c8e15d4f5c2625aba409cbb45b077be7b75c02376e5fdd8c6caf554580` |
| dhl | `WEBPAGE_LOAD_FAILED`, `net::ERR_HTTP2_PROTOCOL_ERROR`, HTTP 418 | 0 | `0xa1c4e1f95be6cc4d62dd6cc99d3b32f3dde217d89ef34d86a10b09be34452b58` |
| usps | `WEBPAGE_LOAD_FAILED`, HTTP 403 Access Denied from Akamai | 0 | `0xb629c5e40fa6849116394ef92ddba5269e6797dce9a3112e83a3858d857a1ddc` |
| fedex | no receipt at all: two leader timeouts, then stuck proposing for over two hours | - | `0x647ff62c0c7bf308b2354cb99ab65ee6dc49f99686b277cb9f1fd0c713b684de` |

Three of the four refused the request at the network edge, before any page was
rendered, so there was nothing for `mode='text'` to return and nothing for the
model to read. The validators did agree on the stored `ERROR` records, which is
the part that worked: a blocked carrier produces consensus on a legible failure
rather than a stalled transaction. That probe also measured the write latency
this study assumes elsewhere: 20 to 25 minutes per write to reach ACCEPTED,
with leader timeouts or idleness strikes on every single transaction in the run.

### A.2 `gl.nondet.web.get` / `post` / `request` -- EXISTS

Pinned SDK, `genlayer/gl/nondet/web.py:1-108`: `get`, `post`, `delete`, `head`,
`patch`, and the general `request(url, *, method, body, headers)`. Methods
accepted by the type: `GET, POST, DELETE, HEAD, OPTIONS, PATCH` (line 94).
Headers are `dict[str, str | bytes]` and are passed through (lines 98-108).
Return type is `Response(status: int, headers: dict[str, bytes], body: bytes | None)`
(lines 24-28) -- the SDK does NOT parse JSON; the contract calls `json.loads`
on `response.body` itself.

Current main adds `put` and `options`, adds a `sign: bool` flag, and validates
the shape of the decoded response (`kzr02.../genlayer/nondet/web.py:1-179`).

Can it call an arbitrary HTTPS endpoint? Within a published policy, yes:

* Schemes: `http` and `https` only. `install/lib/genvm-lua/lib-web.lua:27-32`,
  enforced at line 62 with `SCHEMA_FORBIDDEN`.
* Ports: only 80 and 443 unless the host is in the operator's
  `always_allow_hosts` (`lib-web.lua:85-94`, `PORT_FORBIDDEN`).
* TLD: the host's last label must be in the IANA root zone list compiled into
  the module (`implementation/src/web/domains.rs:1-7`, ~1500 entries; `TLD_FORBIDDEN`
  at `lib-web.lua:110-119`). `google` is present (`domains.rs:545`), `com`
  (`:291`), `io` (`:650`), `dev` (`:357`).
* SSRF: requests that resolve to a non-globally-routable address are blocked,
  failing closed if any resolved address is private
  (`implementation/src/scripting/ctx/dflt.rs:34-40` selecting the filtering
  client; for `render` sub-resources, `webdriver/src/prj/src/ssrf.ts:189-246`).
* Headers: arbitrary, except that `content-length`, `host`, `genlayer-node-address`,
  `genlayer-tx-id`, `genlayer-salt` and any name starting with `@` are dropped
  (`implementation/src/scripting/ctx/req.rs:51-79`).
* Body size: executor `v0.3.x` requires `WEB_REQUEST_MIN_SPACE = 65536` (64 KiB)
  of remaining memory and caps the body at `remaining_memory * 3 / 4`
  (`genlayer_sdk.rs:1158-1191`). No cap at tag `v0.2.16`.
* Forbidden in deterministic mode (`genlayer_sdk.rs:757-760` at `v0.2.16`).

So `https://dns.google/resolve?...` and a public IPFS gateway on a `.io` or
`.com` host are both allowed by the policy. This was checked against the live
resolver -- see section E.

### A.3 `gl.nondet.exec_prompt` -- EXISTS (PARTIAL)

Pinned SDK, `genlayer/gl/nondet/__init__.py:42-106`:

    def exec_prompt(prompt: str, *,
                    response_format: Literal['text','json'] = 'text',
                    images: Sequence[bytes | Image] | None = None) -> str | dict

sent as `{'ExecPrompt': {'prompt', 'response_format', 'images'}}` (lines 97-105).

* Image format: raw bytes. `Image` is a dataclass of `raw: bytes` and a PIL
  handle (lines 36-39); only `.raw` is transmitted (lines 90-95). The bytes go
  through calldata into the LLM module and are base64-encoded into the provider
  request there: an OpenAI-compatible `image_url` data URL
  (`implementation/src/llm/providers.rs:209-218`), a
  `{"type":"image","source":{"type":"base64",...}}` form
  (`providers.rs:793-798`), and Ollama / Google array forms
  (`providers.rs:477-484, 581-590`).
* Maximum images: 2, enforced in the executor.
  `executor/src/wasi/genlayer_sdk.rs:787` at tag `v0.2.16` and `:1199` on
  `v0.3.x`: `if prompt_payload.images.len() > 2 { return Err(Errno::Inval) }`.
* Per-image byte limit: none found in the executor or in the module. UNVERIFIED
  whether any provider-side limit is enforced before the upstream call.
* `response_format='json'`: supported. On the pin the module returns the decoded
  value; on current main the SDK parses and validates it
  (`kzr02.../genlayer/nondet/__init__.py:76-83, 163-174`).
* Model or provider selection: NOT AVAILABLE to the contract. The payload has
  no model field in either version. Selection happens in the node operator's
  Lua policy, which filters providers by `supports_json` / `supports_image`
  (`install/lib/genvm-lua/lib-llm.lua:195-244`) over the operator's configured
  backends (`docs/schemas/default-config.json`, `llm.backends.*.models.*`).
* Forbidden in deterministic mode (`genlayer_sdk.rs:782-785` at `v0.2.16`).

The repo's roadmap note in `docs/FUTURE_FIAT_ESCROW.md` states the 2-image limit
as a documented feature; that is confirmed here in code, not just in docs.

### A.4 Equivalence principles and `gl.vm` -- EXISTS in both

Pinned SDK, `genlayer/gl/eq_principle.py:1-5` exports exactly
`strict_eq`, `prompt_comparative`, `prompt_non_comparative`. Pinned
`genlayer/gl/vm.py:1-10` exports `spawn_sandbox`, `run_nondet_unsafe`,
`run_nondet`, `unpack_result`, `Return`, `VMError`, `UserError`, `Result`.
Current main has the same set (`kzr02.../genlayer/eq_principle/__init__.py`,
`kzr02.../genlayer/vm/__init__.py`).

Error semantics, from the pinned source:

* `strict_eq(fn)` is implemented as `run_nondet_unsafe(fn, validator)` where the
  validator re-runs `fn` inside `spawn_sandbox` and compares the whole `Result`
  object for equality (`eq_principle.py:19-39`). Equality is over the
  calldata-decoded value, so type and value must both match exactly.
* `run_nondet_unsafe(leader_fn, validator_fn)` does NOT sandbox the validator:
  "Validator error will result in a `Disagree` error in executor (same as if
  this function returned `False`)" (`vm.py:156-161`).
* `run_nondet(leader_fn, validator_fn, *, compare_user_errors, compare_vm_errors)`
  runs the validator in a sandbox with `allow_write_ops=True`, requires a bool
  return (raising `TypeError` otherwise), and compares leader and validator
  errors with the supplied comparators, which default to message equality
  (`vm.py:191-264`). A validator that returns a non-bool raises rather than
  silently disagreeing (line 249).
* `prompt_comparative` and `prompt_non_comparative` build on `run_nondet` and
  route the judgement through operator-side prompt templates
  `EqComparative`, `EqNonComparativeLeader`, `EqNonComparativeValidator`
  (`eq_principle.py:78-88, 117-127, 138-149`); the template text is node
  configuration (`docs/schemas/default-config.json`, `llm.prompt_templates`).

One behavioural difference worth knowing: on the pin a nondet failure raises
`NondetException(str)` (`nondet/__init__.py:18-29`); on current main it raises
`NondetException(causes: list[str], ctx: dict)` (`kzr02.../nondet/__init__.py:28-36`),
which is what makes structured error inspection possible. The tracking probe's
recorded errors (`WEBPAGE_LOAD_FAILED`, HTTP 418) came through the pinned
string form.

--------------------------------------------------------------------------------
## B. Deterministic compute available inside a contract

All of B was measured by executing the pinned `cpython.det.wasm`.

### B.5 Big-integer `pow` and `hashlib` -- EXISTS, confirmed by execution

`sys.version` reported by the pinned interpreter:

    3.13.1 (main, Jan_24_2024, 00:42:42) [Clang 18.1.2-wasi-sdk ...]
    sys.platform == 'wasi'

`sys.builtin_module_names` (measured, complete):

    _abc _ast _asyncio _bisect _blake2 _bounded_integers _bz2 _codecs
    _codecs_cn _codecs_hk _codecs_iso2022 _codecs_jp _codecs_kr _codecs_tw
    _collections _common _contextvars _csv _ctypes _datetime _decimal
    _elementtree _functools _generator _genlayer_wasi _heapq _imaging
    _imagingmath _imagingmorph _imp _io _json _locale _lsprof _lzma _md5
    _mt19937 _multiarray_umath _multibytecodec _opcode _operator _pcg64
    _pickle _pocketfft_umath _queue _random _sfc64 _sha1 _sha2 _sha3
    _signal _socket _sre _stat _statistics _string _struct _suggestions
    _symtable _sysconfig _thread _tokenize _tracemalloc _typing
    _umath_linalg _warnings _weakref _webp _zoneinfo array atexit binascii
    bit_generator builtins cmath errno faulthandler gc itertools
    lapack_lite marshal math mtrand posix pyexpat select sys time
    unicodedata zlib

Import results (measured):

| module | result |
|---|---|
| hashlib, hmac, base64, binascii, email, email.parser, email.policy | OK |
| re, json, struct, zlib, decimal, random, secrets | OK |
| datetime, dataclasses, typing, unicodedata, math | OK |
| numpy, PIL.Image | OK |
| socket | OK (importable) |
| **ssl** | **FAIL: `ModuleNotFoundError: No module named '_ssl'`** |

`hashlib.algorithms_available` (measured):
`blake2b, blake2s, md5, sha1, sha224, sha256, sha384, sha3_224, sha3_256,
sha3_384, sha3_512, sha512, shake_128, shake_256`.
`hashlib.sha256(b"abc").hexdigest()` returned the correct
`ba7816bf...f20015ad`. `hmac` over sha256 works.

There is no `_hashlib`: hashing is the HACL* builtins compiled into the
interpreter, not OpenSSL. This is visible in the build too -- the cpython
recipe explicitly builds `Modules/_hacl/libHacl_Hash_SHA2.a`
(`genvm-executor:runners/cpython/default.nix:88`) and the shipped wasm contains
the symbol `python_hashlib_Hacl_Hash_SHA2_digest_256`.

Notes that matter downstream:

* `hashlib` offers `sha3_256`, which is NIST SHA-3, **not** Keccak-256.
  Ethereum-style Keccak is only available as the SDK's pure-Python
  implementation (`genlayer/py/keccak.py`, 414 lines, vendored from
  `github.com/ctz/keccak`). It is slow -- see B.7.
* BLAKE3 is not available. `_blake2` gives BLAKE2b/2s only.
* `ssl` is unusable and no outbound socket exists. The pinned interpreter's WASM
  import section contains `wasi_snapshot_preview1::sock_recv / sock_send /
  sock_shutdown` but **no** `sock_open`, `sock_connect` or `sock_accept`, and
  `getaddrinfo` is disabled at configure time
  (`genvm-executor:runners/cpython/conf.site:3-4` disables `accept`/`accept4`).
  All external I/O goes through the single host function
  `genlayer_sdk::gl_call`. Verified by parsing the import section of the shipped
  `cpython.det.wasm`: `genlayer_sdk::{storage_read, storage_write, get_balance,
  get_self_balance, gl_call}`, WASI preview1, and, in the deterministic build
  only, a `softfloat::*` module supplying emulated f32/f64 arithmetic.

Big-integer `pow` is Python's own and is fast enough to be irrelevant as a
constraint (measured, pinned interpreter under wasmtime):

| operation | measured |
|---|---|
| `pow(sig, 65537, n)`, n 2048-bit | **0.583 ms** |
| `pow(sig, 65537, n)`, n 4096-bit | **2.101 ms** |

### B.6 Signature verification helper -- MISSING

There is no RSA, ECDSA or Ed25519 verification helper anywhere in the SDK, in
either version. A grep for `ecdsa|secp256|ed25519|rsa|verify` over the whole
pinned `genlayer/` tree matches exactly one file, `gl/eq_principle.py`, and only
on the word "verifying" in a docstring. The `evm` submodule is ABI encoding and
cross-chain call plumbing only (`genlayer/py/evm/`). The only cryptographic
primitive the SDK ships is `Keccak256`.

Everything must therefore be written in pure Python inside the contract, or
moved into a separate WASM contract (see F for prior art). Measured cost of
doing it in pure Python in the pinned interpreter:

| operation | measured |
|---|---|
| RSA-2048 PKCS#1 v1.5 verify (the `pow` above) | 0.583 ms |
| NIST P-256 ECDSA verify, naive affine double-and-add | **262.8 ms** |
| NIST P-256 scalar multiplication | 116.4 ms |
| SDK `Keccak256` over 32 bytes | **7.96 ms** |
| SDK `Keccak256` over 1 KB | 35.5 ms |
| SDK `Keccak256` over 20 KB | **582.6 ms** |
| `hashlib.sha3_256` over 20 KB (native, not Keccak) | 0.358 ms |

The ECDSA figure is a naive implementation; Jacobian coordinates and a windowed
ladder would plausibly cut it by 3-5x. The Keccak figure is the SDK's own
shipped code and is ~1600x slower than the native SHA-3 sitting next to it.

### B.7 Gas or compute limits -- PARTIAL; the per-transaction cap is now measured

GenVM does **not** meter WASM instructions. The executor states it plainly:

    // The executor has no cooperative cancellation; the manager kills the
    // process on timeout. wasmtime still requires this flag, so feed it a
    // never-set atomic.
    -- genvm-executor v0.3.x, executor/src/rt/supervisor/mod.rs:376-380

`Host::consume_fuel(gas: U256)` exists (`executor/src/host/mod.rs:444-454`) but
is only called to charge LLM token consumption
(`executor/src/wasi/genlayer_sdk.rs:1239, 1298`). Pure Python compute is not
charged per operation.

What does bound execution:

* A wall-clock deadline enforced by the manager killing the process. The
  deadline value is supplied by the node per transaction; it is not a constant
  in the executor or the manager. **UNVERIFIED** what it is on Bradbury.
  `VmError::timeout` is the resulting receipt code
  (`executor/codegen/data/public-abi.json:82`, mirrored into the SDK at
  `genlayer/py/public_abi.py:37-43`).
* A RAM limiter (`executor/src/rt/memlimiter.rs`), with structural caps
  published in `executor/codegen/data/public-abi.json:56-69` and mirrored into
  the pinned SDK (`genlayer/py/public_abi.py:26-30`):

  | limit | value |
  |---|---|
  | `nondet_blocks` | 4096 |
  | `locked_slots` | 256 |
  | `upgraders` | 32 |
  | `vm_recursion` | 512 |
  | `web_request_min_space` | 65536 |
  | `web_render_min_space` | 134217728 |
  | `max_fds` | 1024 |
  | `event_max_topics` | 4 |

  Identical values on executor branch `v0.2.x` and `v0.3.x`.
* From v0.6, consensus-allocated "time units" and per-bucket fee budgets:
  `leaderTimeunitsAllocation`, `validatorTimeunitsAllocation`,
  `executionBudgetPerRound`, `rotations`, `maxPriceGenPerTimeUnit`,
  `storageFeeMaxGasPrice`, `receiptFeeMaxGasPrice`
  (`kzr02.../genlayer/chain.py:15-41`; fee buckets `storage`,
  `message_receipt`, `nondet_output`, `message_fee`, `event` in
  `genvm-manager:docs/schemas/default-config.json`). Exhausting a bucket
  produces `OOM::fees::{internal,external}` /
  `OOM::receipt::{nondet_output, message::*}` / `OOM::storage`
  (`public-abi.json:94-117`).

* A hard **per-transaction gas cap of 2^24 = 16,777,216**, imposed by the L2,
  not by GenVM. This was UNVERIFIED in the first pass and has since been
  measured directly (`experiments/wasm-deploy-probe/gas_cap_search.py`): the
  same deploy was signed with a freshly generated zero-balance key and offered
  to `eth_sendRawTransaction` at successive gas limits. Validation runs before
  execution, so the node answers without charging and an empty account cannot
  have anything mined even if every other check passes:

      gas = 16,777,215 (2^24-1)   accepted, stopped later by "sender does not have"
      gas = 16,777,216 (2^24)     accepted, stopped later by "sender does not have"
      gas = 16,777,217 (2^24+1)   gas limit too high  (-32602)
      gas = 16,777,218 (2^24+2)   gas limit too high  (-32602)

  The boundary is exact. It is not the block gas limit, which is 100,000,000,
  and `zks_getFeeParams` is not exposed on this node, so the cap was found by
  binary search rather than read from configuration. Whether the cap is
  intentional is UNVERIFIED; see request 9.

Practical answer for this study: a pure-Python RSA-2048 verify costs 0.58 ms and
a relaxed DKIM canonicalisation of a 20 KB body costs 3.3 ms (section E). Those
are not near any plausible per-transaction bound. A pure-Python Keccak over the
same 20 KB, at 583 ms, would be. Note that the 2^24 cap above is a *deployment*
and *submission* constraint priced on calldata bytes, not a compute meter: GenVM
still does not charge Python execution per operation, so the cap binds contract
size (B.9) rather than contract work.

### B.8 Calldata and storage size limits -- PARTIAL

* Calldata decoding enforces a maximum container nesting depth of **128**
  (`executor/crates/calldata/src/bin.rs:307-312` and
  `executor/crates/calldata/src/codec/de/bin.rs:11-16`). No byte cap exists in
  the codec: strings, bytes and arrays are length-prefixed with no ceiling.
* No per-argument or per-field byte limit was found anywhere in the executor or
  the manager.
* Size is bounded economically rather than structurally, through the fee buckets
  above; overrunning yields `OOM::storage` or `OOM::receipt::nondet_output`
  rather than a validation error.
* Events: at most 4 topics; an indexed value whose calldata encoding exceeds 32
  bytes is replaced by its Keccak-256 digest, and shorter ones are zero-padded
  (`genlayer/gl/events.py:8-21`).
* Storage layout: constant-size types stored in place, variable-size types at
  `hash_combine(slot_addr, offset)` (`genvm-manager:docs/adr/008. storage.md`).
  No maximum published.
* The concrete byte ceilings a transaction faces on Bradbury were UNVERIFIED in
  the first pass. They have since been measured, and they are not
  consensus-contract parameters either: they belong to the underlying zkSync
  Elastic Chain L2. Full method and raw sweeps in
  `experiments/wasm-deploy-probe/REVERT_ANALYSIS.md`.

  **Pubdata ceiling.** Sweeping the deploy payload with dummy bytes through
  `eth_estimateGas` on the same `addTransaction` path
  (`experiments/wasm-deploy-probe/size_sweep.py`):

  | code bytes | result |
  |---:|---|
  | 52,224 | OK, gas `0x27b5110` |
  | 52,736 | OK, gas `0x280c901` -- largest accepted |
  | 52,992 | `invalid transaction: BlockPubdataLimitReached` |
  | 65,536 | `invalid transaction: BlockPubdataLimitReached` |
  | 131,072 | bare `execution reverted`, null data -- the same wall, reported worse |
  | 210,488 | bare `execution reverted`, null data |

  So the pubdata ceiling sits **between 52,736 and 52,992 bytes of payload**.
  It reproduced deterministically across many calls, so it is a hard cap and
  not transient congestion. Every calldata byte becomes pubdata that has to be
  published, and one transaction cannot exceed what one block can hold. At and
  above 131,072 bytes (128 KiB) the node stops returning the message and gives
  a bare `execution reverted` with null `data`, which is what makes an
  oversized deploy look like a contract-level revert when it is not.

  **The gas cap binds first.** 52,736 bytes already estimates at about 42
  million gas, so the 2^24 per-transaction cap of B.7 is reached well before
  the pubdata ceiling. The operative deploy limit is roughly 20 kB of code, not
  52 kB. See B.9.

* **`eth_estimateGas` on Bradbury omits the intrinsic calldata cost.** This is
  not a size limit but it is the reason a correctly sized deploy can still
  fail. The first real WASM deploy estimated at 2,222,870 gas, was signed at
  exactly that, was broadcast, and reverted:

      L2 tx     : 0xd6255f352501dcc102869c201dce91c901fb2e40c354d54428cbc19271b8848e
      block     : 22,498,212
      gas limit : 2,222,870
      gasUsed   : 2,122,093
      status    : 0 (REVERTED), 0 logs, no NewTransaction event

  `debug_traceTransaction` shows the failure is an out-of-gas five frames deep,
  in a `DELEGATECALL` that got 48,486 gas. The transaction never exhausted its
  own limit -- it used 2,122,093 of 2,222,870 -- but each `CALL` forwards only
  63/64 of what remains, so the 4.7% headroom was gone by the fifth frame.
  `eth_call` and `debug_traceCall` with the same input and the same gas limit
  both succeed and report `used = 2,075,928`; the 46,165-gas gap is the
  intrinsic cost a transaction pays for its 1,700 bytes of calldata and a call
  does not. Simulation therefore hands the nested frames more gas than the real
  transaction has and hides exactly this failure, and `eth_estimateGas` is built
  on that simulation, so re-estimating does not help. The retry signed at 3x the
  estimate succeeded (consensus tx
  `0xc28d91229bbff8ed42ead1baaff872b8799700a4ac63146b321a1cb03d89cec3`).

  This matters because of what the SDKs do with that estimate:

  * **genlayer-py 0.16.3 signs the raw estimate.**
    `genlayer_py/contracts/actions.py` `_prepare_transaction` ends with
    `transaction["gas"] = self.provider.make_request("eth_estimateGas",
    params=[transaction])["result"]` and `_send_transaction` signs that dict
    as-is. No multiplier, no buffer. A deploy sent through
    `client.deploy_contract` therefore reverts out of gas whenever the
    intrinsic-cost gap exceeds the nested frames' headroom.
  * **genlayer-js swallows the estimation revert and broadcasts anyway.** Driven
    through a guard proxy that forwards reads to Bradbury and refuses
    `eth_sendRawTransaction`, `deployContract` on the 210 KB payload logs
    `GenLayer RPC error (eth_estimateGas): execution reverted` followed by
    `Gas estimation failed, using default 200_000`, and proceeds to broadcast.
    A 52 KB deploy estimates at about 42 million gas, so a 210 KB deploy sent
    with a 200,000 gas limit cannot succeed; it spends fees for nothing. The
    guard proxy is the only reason nothing was sent.

### B.9 Contract size ceiling -- MEASURED, and it moved

The 2^24 gas cap (B.7) is not an abstract limit. It already excludes this
repository's own deployed contract.

`contracts/Marketplace.py` v1.4.7, `CONTRACT_VERSION = 147`, is 35,650 bytes of
source. `gen_getContractCode` for `0x68546F0a8d2Af91d5917A03245c1D31296487b3F`
returns those same 35,650 bytes, byte-identical to the file in this repository.
Its deployment was located by binary-searching `eth_getCode` at the ghost
address for the block where code first appears:

    block      : 10,579,477, 2026-05-21 14:38:16Z
    L2 hash    : 0xe98d95cbc014547bb3dde5912083528ed038e18a146e1fd4cdea09540b5c0d6c
    selector   : 0xe71d5196 addTransaction
    txCallData : 35,658 bytes -> RLP[code 35,650 bytes, ctor 0x06, leaderOnly 0]
    gas limit  : 28,759,916
    gas used   : 26,619,597
    status     : 1 (success)

That gas limit is **171.4% of today's 2^24 cap**, and the gas actually consumed
was 158.7% of it. Re-driving the identical payload through the same genlayer-py
calldata path today with a throwaway key, stopping at `eth_estimateGas`
(`experiments/wasm-deploy-probe/estimate_source.py`, nothing sent):

| source | bytes | txCallData | addTransaction | estimated gas | vs 2^24 cap |
|---|---:|---:|---:|---:|---:|
| `contracts/Marketplace.py` as-is | 35,650 | 35,658 | 35,908 | 28,902,212 | **172.3%** |
| same, comments/blanks/docstrings stripped | 35,557 | 35,565 | 35,812 | 28,834,031 | **171.9%** |

The gas schedule has barely moved: 26,619,597 consumed in May against
28,902,212 estimated now for the same bytes. What changed is the ceiling. The
same transaction submitted today is refused at `eth_sendRawTransaction` with
`gas limit too high` before it reaches execution.

**Stripping is not a lever.** The contract has no docstrings, no multi-line
string literals other than one f-string, and exactly one comment -- the runner
directive on line 1, which must survive or GenVM rejects the contract with
`invalid_contract absent_runner_comment`. The only removable content is 100
blank lines, and 7 of those sit inside the multi-line f-string that builds the
dispute prompt, so they are part of the text the model is shown and were kept.
Net: **93 bytes removed, 68,181 gas saved**, still 172% of the cap.
(`experiments/wasm-deploy-probe/strip_source.py`, output verified by comparing
`ast.dump` of both files and by `genvm-lint`.)

**The practical ceiling.** Deploy gas is dominated by calldata, at roughly
**730 gas per byte of source**:

    26,685 bytes -> 21,917,365 gas   over cap
    24,000 bytes -> 19,893,595 gas   over cap
    20,000 bytes -> 16,803,816 gas   over cap
    18,000 bytes -> 15,247,074 gas   fits
    12,000 bytes -> 10,470,360 gas   fits
     8,000 bytes ->  7,428,360 gas   fits

So about **20 kB of source per contract**, and that is before the 3x safety
margin B.8 shows is needed to survive the intrinsic-cost gap. With the 3x
margin the comfortable ceiling is closer to 7 kB per deploy, or 20 kB only if
the deployer is willing to sign at the raw estimate and risk the nested
out-of-gas.

**Consequence.** v1.4.7 cannot be redeployed as one contract on Bradbury, and
cannot be upgraded by redeploy. v1.5 has to be split across contracts. Closing
a 12-million-gas gap by deleting code would mean removing about 16 kB of real
logic, which is not an editing problem.

**When the ceiling moved, and where it comes from.** It was traced to a single
block (`experiments/wasm-deploy-probe/GAS_CAP_HISTORY.md`, full method there).
The cap arrived with a protocol upgrade applied to the L2 at **block
21,205,822, 2026-09-09 12:09:27 UTC**; the chain now answers
`web3_clientVersion` with `zksync-os/v0.24.0`. The last transaction on the
chain carrying a gas limit above 2^24 is that upgrade transaction itself, at
72,000,000 gas (type `0x7e`, UpgradeTxType, tx
`0x756696b4c9434f059369d35efed4e9f852f4a4f7343d319a9b576777b4f56fdb`), which
it could do because service transactions are exempt from the check. Before it,
limits of 70-100 million were routine -- 11,863 of them in one 40,000-block
window eight hours earlier; after it, not one transaction in any window sampled
through 2026-09-21 exceeds 16,777,216, and at least one sits exactly on it. The
block `gasLimit` header field is 100,000,000 before and after, so this is not a
block-level parameter change.

The value is not GenLayer's. It is `DEFAULT_MAX_TX_GAS_LIMIT = 1 << 24` in
ZKsync OS (`matter-labs/zksync-os`, tag `v0.4.0`,
`zk_ee/src/system/metadata/chain_config.rs:15`), the EIP-7825 per-transaction
gas cap, introduced upstream by PR #683 "feat: add runtime chain config",
merged 2026-06-16. It is a **chain configuration parameter, not a fixed
constant**: it is committed into the batch public input, a chain admin may
raise it, and `validate()` refuses only values *below* 2^24. Enforcement is in
the bootloader against `min(block_gas_limit, max_tx_gas_limit)` and is skipped
under `Config::SIMULATION`, which is exactly why `eth_call` and
`eth_estimateGas` still accept a `gas` field of 100,000,000 while
`eth_sendRawTransaction` refuses 2^24+1.

GenLayer published nothing about this upgrade: no changelog entry, release note
or docs page mentions the cap or the date. Other builders hit the same wall
independently -- `genlayerlabs/genlayer-cli` issue #419, filed 2026-09-15, six
days after the upgrade, reports a 46 kB contract refused with `gas limit too
high`, and a comment of 2026-09-18 brackets the ceiling at 16,777,216 accepted
/ 16,800,000 refused, matching the binary search in B.7. That issue is still
open with no maintainer answer. Two points remain **UNVERIFIED**: whether
GenLayer chose to keep the 2^24 default or simply inherited it, since the
upstream design lets a chain admin raise it and no public artifact records a
decision; and the exact code path in the running `zksync-os/v0.24.0` build that
arms the submission-time check, since the newest public release of
`zksync-os-server` is v0.23.0 and public main would not arm the pool-level
check on its own.

--------------------------------------------------------------------------------
## C. Scheduling and events

### C.9 Self-scheduling and reaction to finalization -- PARTIAL

**What exists on the pinned runner.** `genlayer/gl/genvm_contracts.py:21` defines
`type ON = Literal['accepted', 'finalized']`, and
`ContractProxy.emit(*, value, on)` / `emit_transfer(*, value, on)` /
`deploy_contract(..., on=...)` all take it (lines 129-153, 321-342). An emit is
recorded as a `PostMessage` in the execution result (lines 94-106); the child
transaction is only created when the parent reaches the named state.

Because `gl.get_contract_at()` accepts any address, a contract can address
**itself**:

    gl.get_contract_at(gl.message.contract_address).emit(on='finalized').step2(...)

That is a working "run this once my current transaction is final" primitive on
the pinned runner today. It is one hop, not a timer.

Event emission also exists on the pin: `gl.advanced.emit_raw_event(topics, blob)`
and the `gl.Event` class (`genlayer/gl/advanced.py:21-36`,
`genlayer/gl/events.py`). Events are receipts, not triggers -- nothing in GenVM
consumes them.

**What v0.6 adds.** The literal is renamed to `'decided' | 'finalized'`
(`kzr02.../genlayer/chain.py:11-12`), the message becomes
`EmitInternalMessage`, and two things are added that matter for escrow:
`use_balance=True`, which funds the follow-up message's fee from the emitting
contract's own balance instead of the sender's prefunded pool, and
`fee_params: InternalMessageParams`, which GenVM meters that fee against
(`kzr02.../genlayer/contract/__init__.py:98-129, 183-228`;
`chain.py:15-41`). Requires the `can_use_balance_for_message_fees` permission
(docstring, `contract/__init__.py:195-198`).

**What does not exist, in either version.** There is no cron, no timer, no
"execute at timestamp T", and no trigger fired by anything other than a
transaction. A contract cannot wake itself at a deadline. Every deadline in
`contracts/Marketplace.py` -- `DISPUTE_WINDOW_SECONDS`,
`MAX_SHIPPING_DELAY_SECONDS`, `PUBLIC_FORCE_REFUND_DELAY_SECONDS` -- still needs
somebody to send a transaction after the clock runs out. MISSING.

DOCS-ONLY, and important for design: external messages (to the EVM layer) can
only be emitted `on='finalized'`, and `on='accepted'` internal messages "may be
emitted again -- potentially multiple times across appeal rounds" and "cannot be
taken back", so the receiver must be idempotent
(`genlayer-docs @ 1cd8e2d:pages/developers/intelligent-contracts/features/messages.mdx`).

--------------------------------------------------------------------------------
## D. Privacy

### D.10 Encryption to validators, threshold decryption, private inputs -- MISSING

A case-insensitive search for `encrypt`, `threshold decrypt`, `private input`
and `confidential` across `genvm-manager/implementation`, `genvm-manager/crates`,
`genvm-manager/docs` and `genvm-executor/executor/src` returns exactly one hit,
and it is unrelated: a comment in `executor/src/modules.rs:68` about not
terminating TLS on an unencrypted link. There is no encryption-to-validators,
no threshold decryption, no sealed input, and no private state anywhere in the
runtime.

**Calldata is public, confirmed live.** Querying the public Bradbury RPC with no
authentication for one of this repository's own probe transactions:

    POST https://rpc-bradbury.genlayer.com
    {"method":"gen_getTransactionReceipt",
     "params":[{"txId":"0x75d404c8e15d4f5c2625aba409cbb45b077be7b75c02376e5fdd8c6caf554580"}]}

returns `sender`, `recipient 0xaac9b4246742afa2937bc119e0e936060fcbbc5a`, and

    txCallData = eeac160461726773151c7570739401315a31323334354530323035323731363838
                 066d6574686f642c70726f626500

which decodes in the clear to the method name `probe` and the arguments `ups`
and `1Z12345E0205271688` -- the exact tracking number the probe was called with.
The public explorer is `explorer-bradbury.genlayer.com`
(`genlayer-docs:pages/developers/networks.mdx:28`), and `txCallData` is a
documented receipt field
(`genlayer-docs:pages/api-references/genlayer-node.mdx`, `gen_getTransactionReceipt`).

Consequence for escrow: anything a buyer or seller passes as an argument --
a delivery address, a receipt image, an order number, an email body -- is
permanently public. This is the single hardest constraint in the whole study.

--------------------------------------------------------------------------------
## E. Feasibility note: DKIM verification of a carrier delivery email

### Verdict: FEASIBLE NOW, with two real caveats (privacy, and replay)

**DNS via DoH through the web module.** Allowed by policy: scheme `https`, port
443, and the TLDs `google` and `com` are both in the compiled IANA list
(`domains.rs:545, 291`). Checked against the live services:

    GET https://dns.google/resolve?name=20230601._domainkey.google.com&type=TXT
    -> {"Status":0, ..., "Answer":[{"name":"20230601._domainkey.google.com.",
        "type":16,"TTL":3600,"data":"v=DKIM1; k=rsa; p="}],
        "Comment":"Response from 216.239.36.10."}

And for a real carrier:

| query | result |
|---|---|
| `s1._domainkey.ups.com` TXT | CNAME to `s1.domainkey.u26694139.wl140.sendgrid.net.`, which holds `"k=rsa; t=s; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6nuqql5nuKk8Mc2fG6bsifx..."` (2048-bit) |
| `s2._domainkey.ups.com` TXT | same shape, second SendGrid selector |
| `selector1._domainkey.ups.com` TXT | CNAME into `upsazure.onmicrosoft.com` |
| `k1._domainkey.ups.com` TXT | inline `v=DKIM1;k=rsa;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC9OJM8...` (1024-bit) |

So the keys are there, they are fetchable over a policy-allowed endpoint, and at
least one carrier still publishes a 1024-bit selector -- which the contract
should reject on sight rather than verify.

**Compute, measured in the pinned interpreter:**

| step | measured |
|---|---|
| RSA-2048 verify (`pow(sig, 65537, n)`) | 0.583 ms |
| DKIM relaxed body canonicalisation, 20 KB, via `re` | 3.261 ms |
| DKIM simple body canonicalisation, 20 KB | 0.004 ms |
| DKIM relaxed header canonicalisation, 5 headers | 0.031 ms |
| `sha256` of 20 KB | 0.144 ms |
| base64 decode of a 344-byte signature | 0.011 ms |
| **whole verify, end to end, excluding the DNS round trip** | **3.295 ms** |

Three milliseconds. Compute is not the obstacle. `hashlib`, `hmac`, `base64`,
`binascii`, `re` and the whole `email` package are all importable (B.5), so
header folding, `b=` stripping and `bh=` comparison can use the stdlib parser
rather than hand-rolled splitting.

**Where it must run, and the consensus trap.** The DNS lookup is a web call, so
the entire verification has to sit inside a non-deterministic block -- web
access returns `Errno::Forbidden` in deterministic mode (A.1, A.2). Leader and
validator each do their own lookup and their own verify. That is fine under
`strict_eq` *only if the function returns a stable projection*. The raw DoH body
is **not** stable:

* `"Comment":"Response from 216.239.36.10."` names whichever anycast node
  answered -- different per validator.
* `TTL` counts down between the leader's call and the validator's.

Returning `response.body` under `strict_eq` will fail consensus intermittently
and look like a network problem. The nondet block must return only the derived
facts: the selector's `p=` key material (or better, a boolean plus the canonical
`d=`/`s=`/`i=` fields and the signed header set), never the envelope.

**What ends up on chain.** Everything the contract is given. Because calldata is
public (D.10), submitting the raw delivery email as an argument publishes the
buyer's name, address and order contents forever. Workable shapes, in
increasing order of privacy:

1. Submit the full email. Simple, and a privacy failure.
2. Submit only the DKIM-Signature header, the signed header set and the body
   hash `bh=`, and have the contract verify the signature over the
   canonicalised headers. This verifies the signature without publishing the
   body, but it does not prove what the body *said*, so it cannot prove the
   tracking number -- unless the tracking number is in a signed header
   (`Subject:` often carries it).
3. Fetch the email from a mailbox inside the nondet block instead of taking it
   as an argument, and return only the verdict. This keeps the body off chain,
   but requires a mailbox endpoint the validators can all reach with
   credentials -- which cannot be supplied privately today (D.10).

**The replay problem, which is not a GenLayer problem.** A valid DKIM signature
proves only that the carrier's mail server signed that message. It does not bind
the message to this trade. A seller holding any delivered-package email can
present it. The contract must bind the tracking number recorded at `ship()` time
to the tracking number appearing in the *signed* portion of the email, and must
reject an email whose date precedes the trade. `contracts/Marketplace.py` already
stores carrier and tracking as opaque strings at ship time, so the binding
material is there.

**Summary.** The primitives needed for E all exist: HTTPS to a DoH resolver,
`hashlib`, `base64`, `re`, `email`, big-int `pow`, and `strict_eq`. No new
primitive is strictly required. Two additions would make it materially safer and
are listed in "Primitive requests": a DNS lookup that returns records without
resolver metadata, and private calldata.

--------------------------------------------------------------------------------
## F. Feasibility note: TLSNotary / zkTLS proof verification inside a contract

### Verdict:
* Notary-signature-only check, in pure Python: FEASIBLE NOW.
* Full TLSNotary presentation verification, in pure Python: NOT FEASIBLE.
* Raw WASM contracts on Bradbury: CONFIRMED WORKING, measured on chain.
* Full verification via the existing GenLayer Labs WASM verifier: NOT
  DEPLOYABLE. At 210,488 bytes it is over both ceilings of B.8 and B.9 -- four
  times the pubdata ceiling and about fifteen times the size the 2^24 gas cap
  allows. A reduced, ECDSA-only verifier would have to fit under about 20 kB.
* Groth16 zkTLS verification, in pure Python: NOT FEASIBLE.

**What a TLSNotary presentation contains.** From the reference Rust
implementation, `github.com/tlsnotary/tlsn`,
`crates/attestation/src/presentation.rs:45-105`, a `Presentation` is three
parts, the last two optional:

    struct Presentation {
        attestation: AttestationProof,          // notary signature over the body
        identity:    Option<ServerIdentityProof>,
        transcript:  Option<TranscriptProof>,
    }

and `verify()` runs, in order: `attestation.verify(provider)`, then
`identity.verify_with_provider(provider, connection_time, server_ephemeral_key,
cert_commitment)`, then `transcript.verify_with_provider(&provider.hash,
transcript_length, transcript_commitments)`.

**The primitives verification needs, named.**

| step | primitive |
|---|---|
| notary signature | ECDSA verify over secp256k1 or NIST P-256 with SHA-256, or secp256k1 with Keccak-256 (`r\|\|s\|\|v`, Solidity `ecrecover` shape). `crates/attestation/src/signing.rs`: `KeyAlgId::K256 = 1`, `KeyAlgId::P256 = 2`; `SignatureAlgId::SECP256K1 = 1`, `SECP256R1 = 2`, `SECP256K1ETH = 3` |
| commitments and Merkle openings | SHA-256, BLAKE3 and Keccak-256. `crates/core/src/hash.rs:25-27` registers all three; ids at `:64-68`. Merkle at `crates/core/src/merkle.rs` |
| server identity | X.509 chain validation against a Web PKI root store (`crates/core/src/webpki.rs`, `rustls_pki_types`), which transitively needs DER/ASN.1 parsing, RSA PKCS#1 v1.5 and RSA-PSS verify, ECDSA P-256 and P-384 verify, name and validity checking -- plus the root store itself |
| TLS binding | verification of the server's ephemeral key signature from the handshake, whose algorithm depends on the negotiated cipher suite |

**Against what the pinned runner has.** SHA-256 and SHA-3: native, fast.
Keccak-256: pure Python only, 7.96 ms for 32 bytes (B.6) -- usable for a handful
of nodes, ruinous for a large Merkle tree. BLAKE3: absent entirely, and a pure
Python BLAKE3 would be far worse than the Keccak figure. ECDSA verify: ~263 ms
naive, call it 50-100 ms optimised. X.509 chain verification: would require
writing an ASN.1/DER parser, RSA-PSS, P-384, name constraints and an embedded
root store as contract source. That is not a feasibility question, it is a
several-thousand-line liability.

So the reduced check -- verify the notary's ECDSA signature over the serialized
attestation body and trust the notary for server identity -- is one ECDSA verify
plus SHA-256 hashing, and runs today in well under a second. The full check does
not.

**Prior art inside GenLayer.** `github.com/genlayerlabs/tls-twitter-bounty`
(description: "TLS Notary Twitter Marketplace - bounty system for verified
Twitter API responses"; last pushed 2026-01-16) is a GenLayer marketplace where
"Worker submits proof, claims bounty; validators verify" and the verifier is a
**separate WASM contract** that the Python contract calls. Its
`tls-verifier-wasm/Cargo.toml` depends on `k256` (ECDSA), `p256` (ECDSA) and
`sha3`, and builds for `wasm32-wasip1`; `deploy_wasm.py` deploys the raw
`.wasm` through `gen_call` with a `deploy` payload. Its `COMPARISON.md` reports:

| metric | TLS Notary | zkTLS |
|---|---|---|
| proof size | ~1.7 KB | ~0.1 KB mock / ~20 KB real |
| verification time | ~1 ms (ECDSA) | ~10-50 ms (Groth16) |
| verifier size (WASM) | 137 KB | 106 KB |
| proving time | ~1-5 s | 80-300 s, GPU recommended |

with the explicit caveat that "Full Groth16 verification not implemented in WASM
verifier (complex pairing operations)" and "zkTLS WASM verifier only validates
output format, not full ZK verification."

Raw WASM contracts are a first-class contract type, not a hack: ADR-002 lists
"WASM file: Linked and run as-is without additional steps" as one of the three
contract types (`genvm-manager:docs/adr/002. code loading.md`). The deployment
script in that repo targets a local Studio endpoint, so whether an arbitrary
WASM contract deploys to Bradbury was UNVERIFIED in the first pass. **It has now
been measured on chain, and it does.**

`experiments/wasm-deploy-probe/` builds a 1,447-byte `no_std` Rust module for
`wasm32-wasip1` whose import set is identical to the tls verifier's
(`genlayer_sdk::gl_call` plus `wasi_snapshot_preview1::{fd_read, fd_write,
environ_get, environ_sizes_get, proc_exit}`), whose exports are `memory`,
`_start`, `__main_void`, and which contains zero float instructions. It was
deployed to Bradbury at address
`0xCf1C0889Cb6fb0643B36Ef43F178CBa3Bd7582BC`, consensus transaction
`0xc28d91229bbff8ed42ead1baaff872b8799700a4ac63146b321a1cb03d89cec3`.
`gen_dbg_traceTransaction` on that transaction returns:

    result_code : 0
    stdout      : '{"probe":"tiny","version":"1"}\n'
    stderr      : ''
      kind      : Return
      data      : {'is_init': True, 'probe': 'tiny', 'version': '1'}
      modules   : ['']

`result_code 0` is `return` in the executor's `result_code` enum
(`public-abi.json`: `return=0, user_error=1, vm_error=2, internal_error=3`).
The `modules` list is the decisive line: a Python contract traces as
`['cpython', 'softfloat']`, and this one carries neither, so a raw WASM module
really ran rather than a Python contract wrapping it. The module also returned
a value from its init path, which the tls verifier does not do -- it prints and
calls `exit(0)` -- so a raw WASM deployment returning through
`gl_call({"Return": ...})` is accepted by the Bradbury executor.

What that does **not** buy is the verifier. At 210,488 bytes
`tls-verifier-wasm/verifier.wasm` is four times the pubdata ceiling of B.8 and
about fifteen times what the 2^24 gas cap of B.7 permits, and no SDK can split
it across transactions today (request 9). The 137 KB TLSNotary verifier and the
106 KB zkTLS verifier from that repo's own `COMPARISON.md` are both equally out
of reach. A verifier that does only the reduced check -- one ECDSA verify over
the serialized attestation body, SHA-256 hashing, no X.509 -- is the only shape
that could fit, and it would have to come in under roughly 20 kB of WASM.

**Groth16 in pure Python, sized.** Measured in the pinned interpreter, a modular
multiplication in the BN254 base field (254-bit prime) takes **1397 ns**
(0.72 M/s). Taking rough operation counts -- ~54 Fp multiplications per Fp12
multiplication, order 15,000 Fp multiplications per pairing -- gives ~21 ms per
pairing and ~63 ms for the three pairings of a Groth16 verify, *before* Fp2/Fp6
tower overhead, the final exponentiation, and Python object churn. Realistically
several hundred milliseconds to a few seconds, with a large hand-written field
tower as contract source. Not a sensible thing to put in a Python contract.

**Published verifier specifications, for citation.**

* TLSNotary: protocol site `https://tlsnotary.org/`, documentation
  `https://tlsnotary.github.io/docs-mdbook/`, reference implementation
  `https://github.com/tlsnotary/tlsn` (`crates/attestation/src/presentation.rs`,
  `crates/attestation/src/signing.rs`, `crates/core/src/hash.rs`,
  `crates/core/src/merkle.rs`, `crates/core/src/webpki.rs`), proof explorer
  `https://github.com/tlsnotary/explorer`.
* Reclaim Protocol: attestor server and claim format
  `https://github.com/reclaimprotocol/attestor-core`, docs
  `https://docs.reclaimprotocol.org/understanding-the-tech` and
  `https://docs.reclaimprotocol.org/attestor-decentralization`, JS SDK with
  `verifyProof` `https://github.com/reclaimprotocol/reclaim-js-sdk`. Model:
  attestor signs a structured "claim"; verification is attestor-signature
  checking plus claim matching -- the same shape as the reduced TLSNotary check
  and equally feasible in pure Python.
* Opacity Network: `https://docs.opacity.network/`. MPC plus TEE attestation
  plus economic slashing; verification depends on the TEE attestation format
  rather than on a succinct proof.
* Pluto: productionizes TLSNotary for smart-contract consumption. No verifier
  specification URL could be confirmed from a primary source. UNVERIFIED.
* GenLayer's own comparison and both verifiers:
  `https://github.com/genlayerlabs/tls-twitter-bounty` (`COMPARISON.md`,
  `tls-verifier-wasm/`, `zktls-verifier-wasm/`, `deploy_wasm.py`).

**Practical conclusion for escrow.** TLSNotary or Reclaim is the better shaped
tool than DKIM for carrier data, because it can attest a carrier *API* response
rather than an email, and because the repo's own probe already established that
carrier *web pages* are unreachable from validators. But it needs one primitive
GenLayer does not have: a native signature-verification call. Without it the
options are a 263 ms pure-Python ECDSA per proof, or a second contract in WASM
-- and the WASM route is now known to work as a mechanism while being closed
off for the only verifier that exists, which would have to be rewritten under
20 kB before it could be deployed at all.

--------------------------------------------------------------------------------
## Primitive requests

Only items assessed MISSING or PARTIAL appear here. They are listed in order of
impact on this escrow, not in the order the sections above raise them; the
numbers are stable identifiers, so request 4 stays request 4 wherever it sits.
Requests 4 and 9 are the two that block work outright today: one makes the
product unusable with real buyers, the other makes the next version
undeployable.

**4. Private calldata (D.10, MISSING).** Transaction calldata is fully public --
a live query of the public Bradbury RPC returned this repository's own probe
arguments, including the tracking number, in the clear with no authentication.
For a physical-goods escrow that means the buyer's shipping address, the order
contents and any evidence document are permanently published the moment they are
submitted, which is disqualifying for real use regardless of how good the
dispute logic is. Minimal API: an input field encrypted to the validator set --
`gl.message.private_args`, decryptable only inside the VM during execution and
never written to the receipt -- with the receipt carrying a commitment instead.
Threshold decryption to the active validator quorum is the natural construction
given the existing leader/validator rotation. Prior art: Secret Network's
encrypted inputs and outputs via TEEs; Oasis Sapphire's confidential EVM;
Penumbra's and Aztec's shielded transaction models; Shutter Network's threshold
encryption for mempool privacy, which matches GenLayer's committee structure
most closely.

**9. Contract size: raise `max_tx_gas_limit` on Bradbury (B.9, MISSING).** A
whole contract has to arrive in one transaction's calldata, and that
transaction is capped at 2^24 = 16,777,216 gas, which at roughly 730 gas per
byte of source is about 20 kB of code -- less once the 3x margin B.8 shows is
necessary is applied. This repository's own `contracts/Marketplace.py` v1.4.7
is 35,650 bytes and was deployed on Bradbury on 2026-05-21 at block 10,579,477
with a gas limit of 28,759,916 and 26,619,597 gas consumed, successfully. The
identical bytes estimate at 28,902,212 gas today, 172.3% of the cap, and are
refused at `eth_sendRawTransaction` with `gas limit too high` before execution.
The gas schedule barely moved; the ceiling did, at a single known block --
21,205,822, 2026-09-09 12:09:27 UTC (B.9). A contract that was deployable in
May is not deployable in September, and nothing about the contract changed.
Stripping is not a lever: the file has one comment (the mandatory runner
directive), no docstrings, and removing every removable blank line saves 93
bytes and 68,181 gas. The practical consequences today are that v1.4.7 cannot
be redeployed or upgraded by redeploy, that v1.5 must be split across contracts
for reasons that have nothing to do with its design, and that the 210 KB
GenLayer Labs WASM verifier (F) is undeployable by any SDK. Other teams are
blocked in the same way: `genlayerlabs/genlayer-cli` issue #419, open since
2026-09-15, is a 46 kB contract that cannot be deployed or patched.

**The primary ask is a configuration change, not a protocol feature.** The cap
is `DEFAULT_MAX_TX_GAS_LIMIT = 1 << 24` in ZKsync OS, EIP-7825's
per-transaction gas limit, and ZKsync OS treats it as a **chain configuration
parameter that the chain admin may raise**: `ChainConfig::validate()` rejects
only values *below* 2^24, and the config is committed into the batch public
input, so raising it is a supported, proof-bound operation rather than a patch.
Concretely: set `max_tx_gas_limit` for Bradbury to something that clears a
realistic Intelligent Contract with the 3x margin -- 48,000,000 would restore
the 35 kB that deployed in May and leave headroom -- and publish the value
(request 7). No fork of ZKsync OS, no change to GenVM, and no new SDK surface
is required. Until then, please also state the ceiling in the network
documentation, because today it is discoverable only by binary search on
`eth_sendRawTransaction` and by the receipt of a failed deploy.

**Structural fallback, if the cap has to stay.** If the 2^24 default is
deliberate and permanent, then contract size needs a path that does not run
through one transaction's calldata, because raising the cap alone only moves
the wall to about 52 kB anyway: the second, looser L2 ceiling is
`BlockPubdataLimitReached`, between 52,736 and 52,992 bytes of payload (B.8).
Minimal API: chunked deployment -- an `initCode` accumulator addressed by hash,
filled by N transactions and finalized by one, or a `deployFromBlobs`-style
path that keeps code out of calldata pubdata. Prior art: EIP-4844 blobs and
EIP-7702-era discussions of code sourcing on Ethereum; Solana's
`BPFLoaderUpgradeable` `Write` instructions, which stream a program into a
buffer account across many transactions and then deploy from it, solving
exactly this problem for exactly this reason; NEAR's separate `DEPLOY_CONTRACT`
action priced off storage rather than transaction calldata.

**Direct question for the protocol team:** is Bradbury's `max_tx_gas_limit`
still at the ZKsync OS default of 2^24 by choice? Whether the default was kept
deliberately or simply inherited with the 2026-09-09 upgrade is **UNVERIFIED**;
no changelog, release note or docs page records the upgrade, the cap or a
decision, and issue #419 has no maintainer answer. The value retroactively
invalidated a deployment this chain itself accepted four months earlier, so if
it is deliberate it needs publishing, and if it is not it is a regression with
a one-line fix.

**1. Native signature verification (B.6, MISSING).** Every evidence design that
is not "ask a language model what it thinks the page says" ends at a signature
check: DKIM needs RSA PKCS#1 v1.5, TLSNotary and Reclaim need ECDSA over
secp256k1 and P-256, and payment-rail receipts increasingly carry Ed25519. Today
the SDK ships no verification primitive at all, and the contract pays 263 ms per
ECDSA verify in pure Python -- with the correctness risk of a hand-written curve
implementation sitting in escrow logic that holds funds. Minimal API:
`gl.crypto.verify(alg, public_key: bytes, message: bytes, signature: bytes) -> bool`
with `alg` drawn from a small closed set -- `rsa-pkcs1-sha256`,
`ecdsa-secp256k1-sha256`, `ecdsa-p256-sha256`, `ed25519` -- callable from
deterministic code, returning a bool and never raising on malformed input.
Prior art: the EVM's `ecrecover` precompile and EIP-198 `modexp`; Solana's
`ed25519` and `secp256k1` program instructions; NEAR's `ed25519_verify` host
function; and, inside GenLayer itself, `genlayerlabs/tls-twitter-bounty`'s
`tls-verifier-wasm`, which already links `k256` and `p256` into a 137 KB WASM
verifier precisely because the Python side cannot do this.

**3. Self-scheduled execution at a deadline (C.9, MISSING).** A contract can
already continue itself at finalization by emitting an internal message to its
own address with `on='finalized'`, but it cannot wake up at a wall-clock time.
Every timeout in the escrow -- the shipping window, the dispute window, the
public force-refund delay -- therefore depends on some interested party sending
a transaction after the clock expires, which is exactly the party least motivated
to send it when the timeout favours the counterparty. Minimal API:
`gl.chain.schedule_self(at: u64, method: str, args, *, fee_params, use_balance=True)`,
returning a cancellable handle, executing at most once at or after `at`, funded
from the contract's own balance via the `use_balance` mechanism v0.6 already
added for internal messages. Prior art: Ethereum's Chainlink Automation and
Gelato as external keeper networks; Substrate's `pallet_scheduler`; NEAR's
cross-contract promises with deferred execution. GenLayer is unusually well
placed to do this natively because validators are already scheduled per
transaction and `InternalMessageParams` already describes how to price a
contract-funded future execution.

**6. A DNS record primitive (E, MISSING; currently PARTIAL via DoH).** DKIM
verification needs one TXT lookup, and doing it over a DoH endpoint works but
returns a body that is deliberately not byte-stable: `dns.google` includes
`"Comment":"Response from 216.239.36.10."` naming the anycast node that answered,
and every record carries a decrementing `TTL`. A contract that returns that body
under `strict_eq` will fail consensus intermittently, and the failure will look
like a network fault rather than a design error. It also silently couples the
contract to one resolver operator's JSON shape. Minimal API:
`gl.nondet.dns.query(name: str, type: Literal['TXT','A','AAAA','CNAME','MX']) -> list[str]`
returning only record data, sorted, with no TTL, no resolver identity and no
transport metadata -- the stable projection, computed once, host side. Prior art:
Chainlink's DNSSEC oracle and the `ens-dnssec` resolver contracts on Ethereum,
which solve the same "get a signed DNS record on chain" problem; and GenVM's own
`web` module Lua layer, which is exactly where such a normalisation belongs.

**5. Request headers and user agent for `web.render` (A.1, PARTIAL).**
`gl.nondet.web.request` accepts arbitrary headers but `gl.nondet.web.render` --
the only mode that executes JavaScript, and therefore the only mode that can
read a modern carrier page -- accepts none. This repository's own probe recorded
UPS and DHL answering HTTP 418 and USPS answering HTTP 403 from its CDN, with
zero bytes of page text, which is bot mitigation reacting to the request shape
before any rendering happened. Minimal API: extend the `WebRender` payload with
`headers: dict[str, str]` subject to the same `DROP_HEADERS` normalisation the
request path already applies, and a `user_agent: str`. Prior art: every headless
browser API exposes this, and the sidecar is puppeteer, whose
`page.setExtraHTTPHeaders` and `page.setUserAgent` make the implementation
mechanical. Honest caveat: this raises the odds on some sites and changes nothing
on the ones enforcing full browser fingerprinting, which is why request 1 matters
more.

**8. Per-call model or capability hints for `exec_prompt` (A.3, PARTIAL).** The
contract can ask for `response_format='json'` and pass up to two images, but
cannot express anything about the model, and selection is entirely the node
operator's Lua policy. For escrow this matters in one specific way: a dispute
that hinges on reading a payment receipt or a damaged-goods photo needs a model
with real vision capability, and a contract has no way to require one or to
learn that it did not get one -- it just gets a worse answer, and validators
running different backends disagree for reasons the contract cannot see.
Minimal API: an optional `capabilities: set[Literal['vision','json','long_context']]`
on `exec_prompt` that the node's policy must satisfy or fail the call explicitly,
plus a returned descriptor naming what was actually used, so the equivalence
principle can compare like with like. Prior art: OpenRouter's model routing with
required-capability filters; the `supports_image` / `supports_json` flags GenVM's
own config already carries per model, which the Lua policy already filters on --
the information exists, it is simply not addressable from the contract.

**2. Native Keccak-256 and BLAKE3 hashing (B.6, PARTIAL).** `hashlib` gives
SHA-2 and SHA-3 natively but not Keccak-256, so the SDK ships a 414-line pure
Python Keccak that costs 7.96 ms for 32 bytes and 583 ms for 20 KB -- against
0.358 ms for native SHA-3 on the same 20 KB. Any contract that hashes
Ethereum-style data, checks a Merkle path, or verifies a TLSNotary commitment
tree pays this ~1600x tax, and BLAKE3, which TLSNotary registers as a first-class
commitment algorithm, is not available at any price. Minimal API: add
`keccak256` and `blake3` to the interpreter's `hashlib` builtins, exactly as
`sha3_256` is today, so `hashlib.new("keccak256", data)` works. Prior art: the
`SHA3` opcode in the EVM; `pysha3` and `eth-hash` in the wider Python ecosystem;
and the fact that GenVM already compiles HACL* SHA-2 and SHA-3 into the
interpreter, so this is a build-configuration change, not new cryptography.

**7. Published calldata, storage and receipt size limits (B.8, PARTIAL).** The
codec enforces a container depth of 128 and nothing else; actual size limits are
economic, enforced by fee buckets that surface as `OOM::storage` or
`OOM::receipt::nondet_output`. A contract author designing an evidence field --
how many bytes of page excerpt to store, how large a receipt image may be -- has
no number to design against and finds the ceiling by hitting it in production.
This is a documentation and introspection request rather than a new capability:
publish the per-network byte ceilings, and expose the remaining budget to the
running contract as something like `gl.chain.remaining_budget(bucket)` so a
contract can degrade gracefully instead of aborting. Prior art: Ethereum's
`GASLIMIT` opcode and `gasleft()`; Solana's documented 10 MB account and 1232
byte transaction limits; NEAR's published `max_arguments_length`.

--------------------------------------------------------------------------------
## Appendix: quick reference, pinned runner vs current main

| capability | pinned `1jb45aa8...` | current main (`kzr02...` / v0.6) |
|---|---|---|
| `web.render` modes | text, html, screenshot | same |
| `web.render` wait field | `wait_after_loaded` | `post_load_wait` |
| `web.render` custom headers | no | no |
| `web` HTTP verbs | GET POST DELETE HEAD PATCH (+ OPTIONS in the type) | + PUT, OPTIONS |
| node-signed web request (`sign=`) | no | yes |
| `web` response body cap | none at executor v0.2.16 | `remaining_mem * 3/4`, min space 64 KiB / 128 MiB |
| `exec_prompt` images | max 2, raw bytes | max 2, raw bytes |
| `exec_prompt` model selection | no | no |
| nondet error detail | `NondetException(str)` | `NondetException(causes, ctx)` |
| `strict_eq` / `prompt_comparative` / `prompt_non_comparative` | yes | yes |
| `run_nondet` / `run_nondet_unsafe` / `spawn_sandbox` | yes | yes |
| `emit(on=...)` | `'accepted' \| 'finalized'` | `'decided' \| 'finalized'` |
| contract funds its own follow-up message | no | yes (`use_balance` + `fee_params`) |
| timer / cron | no | no |
| signature verification helper | no | no |
| native Keccak-256 | no (pure Python, 8 ms / 32 B) | no |
| private inputs | no | no |
