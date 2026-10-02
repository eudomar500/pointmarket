# Lacre proof demo

`EscrowProofDemo.py` is `contracts/EscrowDemo.py` with `gmail.com` appended
to `CARRIER_DOMAINS`. Nothing else differs: same code, same demo windows,
same version number.

## Why it exists

The Lacre delivery proof has not been exercised end to end on Bradbury yet,
and that needs a DKIM-signed email from an allowed carrier, sent after the
buyer paid. A real shipping email from amazon.com, ups.com, fedex.com or
dhl.com is not available on demand. Any Gmail account can send a signed
email in a minute, so this build accepts `gmail.com` and lets the whole path
run: attest on Lacre, submit the record id, the Escrow checks it, the claim
window shortens.

It is a test build. It is not the production Escrow, and the frontend does
not point at it.

## Generate and check

Never edit `EscrowProofDemo.py` by hand. Regenerate it from `Escrow.py`:

```bash
python3 scripts/make_escrow_demo.py --extra-carrier gmail.com \
    --out experiments/lacre-proof/EscrowProofDemo.py
diff contracts/EscrowDemo.py experiments/lacre-proof/EscrowProofDemo.py   # one line

python3 experiments/wasm-deploy-probe/strip_source.py \
    experiments/lacre-proof/EscrowProofDemo.py /tmp/EscrowProofDemo.deploy.py
ESCROW_SOURCE=/tmp/EscrowProofDemo.deploy.py python3 -m pytest tests/test_escrow.py
python3 experiments/wasm-deploy-probe/estimate_source.py /tmp/EscrowProofDemo.deploy.py
```

## Run on Bradbury

Two funded wallets, a seller and a buyer. `PROBE_PK` selects the signer.

1. Deploy (the constructor defaults to the Lacre Router):
   `PROBE_PK=<seller> python3 experiments/wasm-deploy-probe/deploy_bradbury.py --source experiments/lacre-proof/EscrowProofDemo.py`
2. Seller lists:
   `python3 scripts/write_bradbury.py <escrow> create_listing --arg "proof test" --arg "lacre e2e" --arg 1000000000000000 --arg ""`
3. Buyer pays:
   `PROBE_PK=<buyer> python3 scripts/write_bradbury.py <escrow> accept_listing --arg <id> --value 1000000000000000`
4. Seller ships with `gmail.com` as the carrier domain:
   `python3 scripts/write_bradbury.py <escrow> mark_shipped --arg <id> --arg TEST123 --arg gmail --arg gmail.com --arg ""`
5. From a Gmail address, send any email after step 3, then attest it with the
   seller wallet on https://lacre.in-sidr.xyz and wait for the record to be
   final (about 35 minutes).
6. Seller submits the record:
   `python3 scripts/write_bradbury.py <escrow> submit_delivery_proof --arg <id> --arg <record id>`
7. Read `get_trade(<id>)`: `delivery_proof` holds the record id and
   `claim_at` is the earlier of `shipped_at + DISPUTE_WINDOW` and
   `proof_at + PROOF_CLAIM_DELAY` (3,600 s and 600 s in the demo build).

Timing: the demo dispute window is one hour from shipping and a Lacre record
takes about 35 minutes to finalize, so the proof only shortens the window if
it is submitted within 50 minutes of step 4. Send and attest the email right
after step 3 (it only has to be signed after payment), and ship once it is
close to final.

Worth trying once the happy path works: the same record on a second trade,
and an email sent before step 3. Both must be refused with
`[EXPECTED] no accepted attestation`.
