# Tracking probe (throwaway feasibility experiment)

## Purpose

Before designing validator-verified delivery tracking for the marketplace, we
need one fact we do not currently have: **can a GenLayer validator actually read
a public carrier tracking page?**

Today `Marketplace.py` accepts a carrier and a tracking number as opaque strings
and never checks them. The obvious next step is to have validators confirm
delivery from the carrier's own page. That only works if the page is readable
from a validator's headless browser. Carriers actively defend those pages with
bot checks, captchas, cookie walls and client-side rendering, and the answer is
likely to differ per carrier.

This contract measures that, one carrier at a time, and records what the
validator saw so the failure mode is legible rather than a rollback. It is a
throwaway probe. It is not meant to be deployed as part of the product.

What it records per probe:

- whether the LLM could find tracking data at all (`found`)
- a coarse status (`DELIVERED`, `IN_TRANSIT`, `EXCEPTION`, `NOT_FOUND`,
  `BLOCKED`, `UNKNOWN`, or `ERROR` if the nondet block threw)
- `raw_length`, the size of the full rendered text, which separates "empty
  shell" from "real page we failed to parse"
- `page_excerpt`, the first 800 characters of rendered text, which is also
  exactly what the LLM was shown

Consensus is the second measurement. The validator re-renders the page and
re-runs the prompt, and accepts the leader only if `found` and `status` both
match. A carrier that reads fine but never reaches validator agreement is just
as unusable as one that is blocked.

## Carrier URL templates

Defined in the `CARRIERS` constant at the top of `tracking_probe.py`. Correct
them there if a carrier changes its query parameter.

| Carrier | Template | How it was verified |
|---------|----------|---------------------|
| ups | `https://www.ups.com/track?loc=en_US&requester=ST&tracknum={tracking}` | `GET` against www.ups.com returns HTTP 200 with no redirect; `tracknum` is the parameter the carrier's own tracking page uses. |
| fedex | `https://www.fedex.com/fedextrack/?trknbr={tracking}` | `GET` against www.fedex.com returns HTTP 200 with no redirect; `trknbr` is the parameter used by fedex.com/fedextrack. |
| dhl | `https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id={tracking}` | DHL's `tracking-express.html?submit=1&tracking-id=...` redirects (HTTP 200) to this canonical `tracking.html` URL keeping both parameters, and `tracking-id` appears as the tracking input name in the page source. Template uses the post-redirect URL to avoid a hop. |
| usps | `https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}` | `tLabels` is the long-standing public deep-link parameter for USPS Tracking on tools.usps.com, and is the URL usps.com's tracking results are indexed under. Could not be confirmed by direct request: see the note below. |

### Known before running

Two things already showed up while checking the templates, and they are the
reason the probe exists:

- **USPS returned HTTP 403 to every plain request** from two different network
  paths, with a ~400 byte body. Expect `BLOCKED` or `ERROR` unless the
  validator's headless browser gets further than a plain client does.
- **FedEx served a "System Down / you don't have permission to view this
  webpage" interstitial** to one fetch while returning HTTP 200 to another.
  FedEx may be inconsistent between leader and validator, which is exactly the
  consensus failure this probe is built to catch.

All four pages render their tracking data client-side, so the probe passes
`wait_after_loaded="5000ms"` to `gl.nondet.web.render`. Without it the probe
would only ever measure the empty shell. Tune `RENDER_WAIT_AFTER_LOADED` if the
excerpts come back as boilerplate.

## Deploy

Target is Testnet Bradbury, using the stable SDK runner pinned in the contract
header (the same pin as `contracts/Marketplace.py`).

```bash
genlayer network set testnet-bradbury
genlayer account
genlayer deploy --contract experiments/tracking-probe/tracking_probe.py
```

The constructor takes no arguments. Fund the account from
https://testnet-faucet.genlayer.foundation/ first if `genlayer account` shows a
zero balance. Note the deployed address; it is written as `<ADDRESS>` below.

## Call once per carrier

Substitute your own real tracking numbers. Each call is one write transaction
and one probe record, numbered from 0 in call order.

```bash
genlayer write <ADDRESS> probe --args ups   <UPS_TRACKING_NUMBER>
genlayer write <ADDRESS> probe --args fedex <FEDEX_TRACKING_NUMBER>
genlayer write <ADDRESS> probe --args dhl   <DHL_TRACKING_NUMBER>
genlayer write <ADDRESS> probe --args usps  <USPS_TRACKING_NUMBER>
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
when a probe came back as `ERROR`.

```bash
genlayer receipt <TX_HASH>
genlayer receipt <TX_HASH> --stderr
```

## Results

Run of 2026-09-21 on Testnet Bradbury. Contract
`0xaAc9b4246742afa2937BC119e0e936060fcbbc5A`, deployed in tx
`0x97506d7bf7545196c06518cebc62f777e0369a4d67287f44266107adeca35b4e`, which took
22 minutes to reach ACCEPTED through one leader rotation and three validators
replaced for idleness.

The tracking numbers below are format-valid samples taken from carrier developer
documentation, not live shipments. A sample number cannot show a delivered
shipment, but it is enough to answer the question the probe was built for:
whether the page can be fetched at all.

| carrier | tracking used | status | found | tracking_seen | raw_length | page_excerpt summary | validators agreed (y/n) | tx hash |
|---------|---------------|--------|-------|---------------|------------|----------------------|-------------------------|---------|
| ups | 1Z12345E0205271688 | ERROR | false | false | 0 | `NondetException WEBPAGE_LOAD_FAILED`, navigation `net::ERR_ABORTED`, HTTP 418 | y (FINALIZED) | `0x75d404c8e15d4f5c2625aba409cbb45b077be7b75c02376e5fdd8c6caf554580` |
| fedex | 449044304137821 | no result | - | - | - | none; the write never produced a receipt | - | `0x647ff62c0c7bf308b2354cb99ab65ee6dc49f99686b277cb9f1fd0c713b684de` |
| dhl | JJD0099999999 | ERROR | false | false | 0 | `WEBPAGE_LOAD_FAILED`, `net::ERR_HTTP2_PROTOCOL_ERROR`, HTTP 418 | y | `0xa1c4e1f95be6cc4d62dd6cc99d3b32f3dde217d89ef34d86a10b09be34452b58` |
| usps | 9400111899223197428490 | ERROR | false | false | 0 | `WEBPAGE_LOAD_FAILED`, HTTP 403 Access Denied from Akamai (`errors.edgesuite.net` reference) | y | `0xb629c5e40fa6849116394ef92ddba5269e6797dce9a3112e83a3858d857a1ddc` |

Per-write notes:

- **ups**: two leader timeouts with appeal before a leader executed; 20 minutes
  to ACCEPTED.
- **fedex**: two leader timeouts within 9 seconds of activation, then stuck in
  proposing for over two hours with the third leader. Not retried.

## Findings

1. Three of the four carriers refused the request before any page rendered. UPS
   and DHL answered HTTP 418, and USPS answered HTTP 403 from its CDN. The
   failure is at the network edge, in bot protection, not in page parsing.
   `raw_length` was 0 in every case, so there was no page text to parse.
2. FedEx produced no result at all. The cause could not be separated between
   validator idleness and a hanging page load.
3. The probe's error handling behaved as designed. Every blocked page produced a
   stored `ERROR` record carrying the HTTP status, and the validators reached
   consensus on that record. A blocked carrier therefore does not stall a
   dispute.
4. Consequence for the marketplace: validator-fetched tracking for these
   carriers is not viable on Bradbury today, and it stays out of the v1.5
   contract. The remaining evidence model relies on anchored photos with
   burden-of-proof rules, asymmetric bonds and reputation, with the tracking
   number kept as a seller-supplied field as in v1.4.7.
5. Candidate for a later spike: carrier delivery-confirmation emails are
   DKIM-signed, and verifying that signature against the carrier's public DNS
   key does not require reaching the carrier's web front end. Not evaluated
   here.
6. Network observation: every transaction in this run saw leader timeouts or
   idleness strikes. Reaching ACCEPTED took 20 to 25 minutes per write, even for
   a deployment with a trivial constructor.

### What the outcome means

- **Readable and agreed on all four**: validator-verified tracking is worth
  designing. Next question is prompt stability across shipment states, not
  access.
- **Readable but validators disagree**: the page is reachable but not stable
  between leader and validator. Consider narrowing what consensus compares, or
  comparing a derived status only.
- **Blocked on some carriers**: per-carrier support, with the blocked carriers
  falling back to the current opaque-string behaviour.
- **Blocked on all four**: drop the page-scraping approach and look at carrier
  APIs with signed requests instead.

## Tests

None. `tests/README.md` describes a direct-mode setup built on
`genlayer_test.direct.DirectClient`, but `tests/` currently contains no test
files and `genlayer_test` is not installed in this environment, so there is no
existing direct-mode setup to run under. The probe's only interesting behaviour
is the nondet block, which direct mode does not exercise anyway.

## Cleanup

Delete `experiments/tracking-probe/` once the table above is filled in and the
decision is recorded. Nothing else in the repo depends on it.
