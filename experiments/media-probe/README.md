# Media probe (throwaway feasibility experiment)

## Purpose

Before designing photo-based delivery evidence for the marketplace, we need one
fact we do not currently have: **can a Bradbury validator fetch an image from a
public IPFS gateway and hand it to the LLM as an image?**

The evidence model in the v1.5 design leans on anchored photos. Anchoring is
cheap: the contract stores a CID and a hash. Reading the photo is the part that
is unproven. It needs three things to hold at once inside a nondet block:

1. `gl.nondet.web.get` returns the raw bytes of a binary body, not a decoded or
   truncated string.
2. `gl.nondet.exec_prompt(..., images=[body])` accepts those bytes and the model
   actually sees the picture.
3. The leader and the validators agree on what they saw, well enough for a
   dispute to resolve.

The sibling `experiments/tracking-probe/` answered the equivalent question for
carrier web pages, and the answer there was no: every carrier refused at the
network edge. This probe asks the same question for IPFS gateways, where there
is no bot protection to fight, and adds the image-to-LLM leg that the tracking
probe never exercised.

It is a throwaway probe. It is not meant to be deployed as part of the product.

## Record shape

Each `probe` write stores one record, returned by `get_probe` as:

| field | type | meaning |
|-------|------|---------|
| `probe_id` | string (u256) | sequence number, from 0 in call order |
| `cid` | string | the CID as passed, trimmed |
| `gateway` | string | gateway key, lowercase |
| `status` | string (u32) | HTTP status; `0` only when the fetch itself raised |
| `byte_length` | string (u256) | body length as observed, also on non-200 |
| `sha256` | string | hex digest of the body on a 200, `""` on any non-200 |
| `is_image` | bool | the model's reading; `false` whenever the model did not run |
| `subject` | string | normalized closed-set label, `""` when the model did not run |
| `dominant_color` | string | free text from the model |
| `error_class` | string | short outcome code, see below |
| `error` | string | free-text detail, bounded to 256 chars |

The leader runs in two stages. The fetch stage calls `gl.nondet.web.get`; only
an exception there produces `status` 0. The model stage runs only on a 200 with
a body within `MAX_IMAGE_BYTES`, and a failure there keeps the real `status`,
`byte_length` and `sha256` from the fetch, because those are the part of the
result that does not depend on the model.

`sha256` is never computed over a non-200 body. Error pages are not content
addressed and frequently embed request ids or timestamps, so hashing them would
only manufacture validator disagreement.

### error_class

| value | when |
|-------|------|
| `""` | fetch returned 200 and the model returned a JSON object |
| `HTTP` | the gateway answered anything other than 200 |
| `EMPTY` | 200 with an empty body |
| `SIZE` | 200 with a body over `MAX_IMAGE_BYTES`; hashed, not sent to the model |
| `FETCH:<ExceptionTypeName>` | `web.get` raised; `status` is 0 |
| `LLM:<ExceptionTypeName>` | the prompt raised, or returned something other than a JSON object (`LLM:TypeError`) |

It is bounded to 48 characters and carries only the outcome and the exception
type, never a message, so it can be compared across nodes. The message goes in
`error`, which is not compared.

### subject normalization

Before the closed-set check the model's `subject` is uppercased and stripped,
every non-alphanumeric character becomes `_`, runs of `_` collapse to one, and
leading or trailing `_` are removed. So `ipfs logo`, `IPFS-Logo` and
`__ipfs__logo__` all become `IPFS_LOGO`. Anything that is not in the closed set
after that becomes `OTHER`.

## Consensus

Consensus is the second measurement. The validator re-fetches and re-prompts,
and accepts the leader only if exactly these five fields match:

- `status`
- `sha256`
- `subject`
- `is_image`
- `error_class`

Not compared: `dominant_color` (free text, expected to drift), `byte_length`
(redundant with a matching `sha256` on a 200, and uninformative without one),
and `error` (node-specific messages). A leader payload that is not a dict, or
is missing any compared field or has it with the wrong type, is rejected
explicitly rather than compared.

A gateway that reads fine but never reaches validator agreement is just as
unusable as one that refuses.

## Accept-Encoding: identity

Every fetch sends `Accept-Encoding: identity`. Without it,
`trustless-gateway.link` serves a Brotli-encoded body, and the hashes differ
between validators: the digest ends up depending on how each node's HTTP stack
negotiated and decoded the response, not on the CID. Asking for the identity
encoding makes every node receive, and hash, the raw block. The header is sent
to every gateway, not only that one, so no gateway's result depends on
negotiation.

The pinned SDK supports this directly. In `py-lib-genlayer-std`
`11rhn002yfajawsz7fai6mykznbxkxs6l91iskj5cm82c92qhy3v` (the dependency of the
runner pinned in the contract header), `genlayer/gl/nondet/web.py`:

```python
def get(
	url: str,
	*,
	headers: dict[str, str | bytes] = {},
) -> Lazy[Response]:
```

## Size limit

`MAX_IMAGE_BYTES` (1,000,000) is a policy ceiling, not the binding one. It
decides whether a body that has already arrived is handed to the model. The
body is fully materialized inside the executor before that check runs, so the
real limit on what can be fetched is the executor's remaining memory at the
time of the call. A body too large for that fails inside `web.get` and is
recorded as `FETCH:<ExceptionTypeName>`, not `SIZE`.

## The test image

| field | value |
|-------|-------|
| CID | `bafkreiftcv76oytyik33cb3tezhlcy664dumgr2eb5ij7wkmx7qkc7xs3q` |
| bytes | 61,111 |
| sha256 | `b3157fe7627842b7b10773264eb163dee0e8c347440f509fd94cbfe0a17ef2dc` |
| media type | `image/png`, 1200 x 630, 8-bit RGB, no alpha |
| content | the IPFS logo, a white cube inside a hexagon, on a dark navy background, beside the word "IPFS" and the line "A constellation of tools for content addressing" |

### Where it comes from

It is `og-image.png` at the root of the official IPFS website, ipfs.tech, which
is itself published to IPFS and reachable by DNSLink. The provenance chain is
reproducible from any machine:

```bash
# 1. resolve the ipfs.tech DNSLink to the site root CID
curl -s -H "accept: application/dns-json" \
  "https://cloudflare-dns.com/dns-query?name=_dnslink.ipfs.tech&type=TXT"
# -> dnslink=/ipfs/<SITE_ROOT_CID>

# 2. list the site root and find og-image.png
curl -s "https://gateway.pinata.cloud/ipfs/<SITE_ROOT_CID>?format=dag-json"
# -> {"Name":"og-image.png","Tsize":61111,
#     "Hash":{"/":"bafkreiftcv76oytyik33cb3tezhlcy664dumgr2eb5ij7wkmx7qkc7xs3q"}}
```

On 2026-09-21 the site root resolved to
`bafybeiejegeowlh5warqnrjjmhbkf7hdjaiuhnpqajbktx6ta77urqmljy`. That root CID
rotates on every site deploy; the `og-image.png` file CID does not, because it
is the hash of the file. Re-run step 2 before a later run if you want to confirm
the current site still references the same asset.

### Why this image and not something else

- It is a `bafkrei...` CIDv1 raw block, so `GET /ipfs/<cid>` with no trailing
  path returns the file itself. No directory resolution, no path handling.
- 61 KB is small enough to keep the write cheap and to sit far under the
  probe's 1 MB ceiling.
- It is opaque RGB on a dark navy field, so `dominant_color` has a real answer.
  The other obvious candidate, `IPFS-logo.png`
  (`bafkreiclsi4uron4zu3f44zl5jjx7ufkze7prj7kuvyf3yvtu2zd77bmse`, 27,147 bytes),
  was rejected after inspection: every opaque pixel in it is pure white on a
  transparent background, so it flattens to a blank white rectangle and cannot
  distinguish "the model saw the image" from "the model saw nothing".
- Its subject is distinctive enough that a closed-set answer is meaningful. A
  model handed no usable image lands on `OTHER`, not on the right answer by
  luck.

### Gateway verification, 2026-09-21T22:06Z, from this workstation

All four of the gateways named in the original plan are unusable. `ipfs.io`,
`dweb.link` and `w3s.link` are the same Protocol Labs path-gateway fleet, and it
is mid-sunset: every non-browser request gets

```
HTTP/2 429
sunset: Mon, 21 Sep 2026 00:00:00 GMT
link: <https://gatewaychanges.ipfs.io/>; rel="sunset"
retry-after: 900

This IPFS gateway is switching to a service worker gateway only.
```

The 429 is unconditional. It does not change with `Sec-Fetch-Dest`, and the
per-CID subdomain form (`<cid>.ipfs.dweb.link`) returns the same. `Retry-After`
is cosmetic: the `Sunset` date is in the past, so this is the terminal state,
not rate limiting. `cloudflare-ipfs.com` no longer resolves in DNS at all.

So the probe ships with four replacement gateways that were verified to return
the exact bytes, plus the three sunset hosts kept as extra keys so their refusal
can also be recorded on chain.

| gateway key | URL | result |
|-------------|-----|--------|
| `pinata` | `https://gateway.pinata.cloud/ipfs/<cid>` | 200, 61,111 bytes, `image/png`, sha256 matches |
| `filebase` | `https://ipfs.filebase.io/ipfs/<cid>` | 200, 61,111 bytes, `image/png`, sha256 matches |
| `pinit` | `https://gateway.pinit.io/ipfs/<cid>` | 200, 61,111 bytes, `image/png`, sha256 matches |
| `trustless` | `https://trustless-gateway.link/ipfs/<cid>?format=raw` | 200, 61,111 bytes, `application/vnd.ipld.raw`, sha256 matches |
| `ipfs-io` | `https://ipfs.io/ipfs/<cid>` | 429, sunset notice |
| `dweb` | `https://dweb.link/ipfs/<cid>` | 429, sunset notice |
| `w3s` | `https://w3s.link/ipfs/<cid>` | 429, sunset notice |
| - | `https://cloudflare-ipfs.com/ipfs/<cid>` | DNS does not resolve; not included in the contract |

`trustless-gateway.link` needs the `?format=raw` query, which the template
carries; without it the host answers 406. It returns
`application/vnd.ipld.raw` rather than `image/png`, which is itself worth
watching: if the model refuses that body while accepting the identical bytes
from the other three, the blocker is content-type sniffing, not the bytes.

To re-verify before a run:

```bash
CID=bafkreiftcv76oytyik33cb3tezhlcy664dumgr2eb5ij7wkmx7qkc7xs3q
for u in "https://gateway.pinata.cloud/ipfs/$CID" \
         "https://ipfs.filebase.io/ipfs/$CID" \
         "https://gateway.pinit.io/ipfs/$CID" \
         "https://trustless-gateway.link/ipfs/$CID?format=raw"; do
  curl -sS -L --max-time 40 -o /tmp/probe.bin \
    -w "%{http_code} %{size_download} %{content_type} " "$u"
  sha256sum /tmp/probe.bin | cut -d' ' -f1
done
# expect: 200 61111 <type> b3157fe7627842b7b10773264eb163dee0e8c347440f509fd94cbfe0a17ef2dc
```

## Source size and deploy cost

Measured with `experiments/wasm-deploy-probe/estimate_source.py`, against the
2^24 per-transaction gas cap that probe established:

```
$ python3 experiments/wasm-deploy-probe/estimate_source.py \
    experiments/media-probe/media_probe.py

media_probe.py
  source bytes    : 11,902
  txCallData bytes: 11,910  (RLP [code, calldata, leader_only])
  addTransaction  : 12,164 bytes
  estimated gas   : 10,397,368  (62.0% of cap)  fits
```

For scale, `tracking_probe.py` is 9,615 bytes and estimates at 8,645,306 gas
(51.5%). The earlier single-stage version of this probe was 9,115 bytes and
8,280,024 gas (49.4%). The growth is consistent with the near-linear
source-size to gas relationship recorded in
`experiments/wasm-deploy-probe/README.md`.

## Deploy

Target is Testnet Bradbury, using the stable SDK runner pinned in the contract
header (the same pin as `contracts/Marketplace.py` and the tracking probe).

```bash
genlayer network set testnet-bradbury
genlayer account
genlayer deploy --contract experiments/media-probe/media_probe.py
```

The constructor takes no arguments. Fund the account from
https://testnet-faucet.genlayer.foundation/ first if `genlayer account` shows a
zero balance. Note the deployed address; it is written as `<ADDRESS>` below.

## Call once per gateway

Four writes, one per verified gateway, all against the same CID. Each call is
one write transaction and one probe record, numbered from 0 in call order.

```bash
CID=bafkreiftcv76oytyik33cb3tezhlcy664dumgr2eb5ij7wkmx7qkc7xs3q

genlayer write <ADDRESS> probe --args $CID pinata
genlayer write <ADDRESS> probe --args $CID filebase
genlayer write <ADDRESS> probe --args $CID pinit
genlayer write <ADDRESS> probe --args $CID trustless
```

Optional, to put the sunset fleet's refusal on chain as well:

```bash
genlayer write <ADDRESS> probe --args $CID ipfs-io
genlayer write <ADDRESS> probe --args $CID dweb
genlayer write <ADDRESS> probe --args $CID w3s
```

## Read the results

```bash
genlayer call <ADDRESS> get_probe_count
genlayer call <ADDRESS> get_probe --args 0
genlayer call <ADDRESS> get_probe --args 1
genlayer call <ADDRESS> get_probe --args 2
genlayer call <ADDRESS> get_probe --args 3
```

For the "validators agreed" column, inspect each write's receipt. Agreement
shows up in the validator votes; `--stderr` shows what the nondet block printed
when a probe came back with a non-empty `error_class`.

```bash
genlayer receipt <TX_HASH>
genlayer receipt <TX_HASH> --stderr
genlayer trace <TX_HASH>
```

## Results

Not yet run. Contract `<ADDRESS>`, deployed in tx `<DEPLOY_TX>`.

Expected sha256 is
`b3157fe7627842b7b10773264eb163dee0e8c347440f509fd94cbfe0a17ef2dc` and expected
`byte_length` is 61111. "sha256 match" means the stored digest equals that
value.

| gateway | status | byte_length | sha256 match | is_image | subject | error_class | validators agreed | tx |
|---------|--------|-------------|--------------|----------|---------|-------------|-------------------|----|
| pinata | | | | | | | | |
| filebase | | | | | | | | |
| pinit | | | | | | | | |
| trustless | | | | | | | | |

## How to read the outcome

- **All four return 200 with a matching sha256, `is_image` true, `subject`
  `IPFS_LOGO`, validators agreed**: validator-read photo evidence is worth
  designing. The next question is prompt stability across real dispute photos,
  not access.
- **Bytes arrive but `is_image` is false or `subject` is `OTHER`**: the fetch
  leg works and the image leg does not. Check whether the body survived as
  bytes, using `byte_length` and `sha256`, before blaming the model.
- **sha256 matches on some gateways and not others**: a gateway is rewriting or
  transcoding the body despite `Accept-Encoding: identity`. Content addressing
  is the point, so that gateway is out.
- **`error_class` is `LLM:...` with a matching sha256**: the fetch leg works
  and the model call failed. The bytes are still proven; only the image leg is
  in question.
- **Bytes arrive and validators disagree**: the fetch is reachable but not
  stable between leader and validator. Narrow what consensus compares, or drop
  `subject` from the comparison and verify only `sha256`, which needs no model
  at all.
- **Everything fails the way the tracking probe did**: validator-fetched media
  is not viable on Bradbury today, and the evidence model falls back to
  hash-commitment only, where the contract stores the CID and hash and humans or
  an appeal resolve the picture off chain.

## A note on what a passing result would and would not prove

Even a clean pass only shows that a validator can fetch and see a picture. It
does not show that the picture is the one the seller took, that it was taken
when they claim, or that the gateway will still serve it at dispute time. The
`sha256` column is the part that carries over into a real design: if the
contract stores the hash at anchoring time, any later fetch can be checked
against it without trusting the gateway.

## Tests

None, for the same reason as the tracking probe. `tests/README.md` describes a
direct-mode setup built on `genlayer_test.direct.DirectClient`, but `tests/`
contains no test files and `genlayer_test` is not installed here. The probe's
only interesting behaviour is the nondet block, which direct mode does not
exercise.

Static checks that were run:

```bash
genvm-lint check     experiments/media-probe/media_probe.py   # lint passes
genvm-lint typecheck experiments/media-probe/media_probe.py   # no type errors
```

`genvm-lint check` reports "Validation failed: No contract class found" for this
file. That is a local linter problem, not a defect here: it reports the same for
every contract in this repository, including `contracts/Marketplace.py`, which
is deployed and working. The AST lint stage passes.

`hashlib.sha256` was confirmed available in the pinned runner's interpreter:
runner `py-genlayer:1jb45aa8...` depends on cpython
`1bk9g3zgym0rrpd9lk584cxfaa4rg0cz36w6xhzkqdj1m2p4xa9n`, whose `cpython.det.wasm`
has `_sha2` in its built-in module table and ships `py/std/hashlib.py`.

## Cleanup

Delete `experiments/media-probe/` once the table above is filled in and the
decision is recorded. Nothing else in the repo depends on it.
