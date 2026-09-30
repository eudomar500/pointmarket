"""Direct-mode tests for contracts/Escrow.py.

The source under test is ESCROW_SOURCE (default contracts/Escrow.py), so the
same suite runs against EscrowDemo.py and against the strip_source.py output
that is actually deployed. Windows are read from that file, never assumed.

Direct mode does not roll storage back when a call raises, so every refused
call here is also a check that the contract validates before it writes.

Two things the runner does are stubbed through the VM's gl_call hook:
  * EthSend, the external message that pays a wallet, is recorded rather than
    executed, so payouts are asserted as (recipient, amount) pairs;
  * CallContract, the cross-contract view, is answered by a stub Lacre Router
    and Verifier, each holding a finalized view and a newer non-final one.
"""

import ast
import base64
import hashlib
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from gltest.direct.loader import create_address

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ.get("ESCROW_SOURCE", ROOT / "contracts" / "Escrow.py")).resolve()


def _constants(path):
    out = {}
    for node in ast.parse(path.read_text()).body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id.isupper()):
            try:
                out[node.targets[0].id] = eval(
                    compile(ast.Expression(node.value), "c", "eval"),
                    {"u8": int, "u16": int, "u64": int, "u256": int})
            except Exception:
                pass
    return out


K = _constants(SOURCE)
DISPUTE_WINDOW = K["DISPUTE_WINDOW"]
PROOF_CLAIM_DELAY = K["PROOF_CLAIM_DELAY"]
UNBOXING_WINDOW = K["UNBOXING_WINDOW"]
RESPONSE_WINDOW = K["DISPUTE_RESPONSE_WINDOW"]
MAX_SHIPPING_DELAY = K["MAX_SHIPPING_DELAY"]
ADMIN_DELAY = K["ADMIN_FORCE_REFUND_DELAY"]
PUBLIC_DELAY = K["PUBLIC_FORCE_REFUND_DELAY"]
UPGRADE_TIMELOCK = K["UPGRADE_TIMELOCK"]

PRICE = 10**18
FEE = PRICE * 200 // 10000
BUYER_BOND = 10**16
SELLER_BOND = PRICE * 500 // 10000
PENALTY = BUYER_BOND * 500 // 10000

NOT_RECEIVED, DAMAGED, NOT_AS_DESCRIBED = 1, 2, 3
OPEN, PAID, SHIPPED, DISPUTED, COMPLETED, CANCELLED, REFUNDED = range(7)

BASE = datetime(2026, 10, 1, tzinfo=timezone.utc)
BASE_TS = int(BASE.timestamp())
LATEST_FINAL = 1
HASH = "ab" * 32


def cid(data: bytes, header=b"\x01\x55\x12\x20") -> str:
    raw = header + hashlib.sha256(data).digest()
    return "b" + base64.b32encode(raw).decode().lower().rstrip("=")


def router_hex():
    # The SDK Address type exists only once a contract is loaded, so the
    # constructor argument is built from the same seed create_address uses.
    return "0x" + hashlib.sha256(b"lacre-router").digest()[:20].hex()


LISTING_CID = cid(b"listing")
PACKING_CID = cid(b"packing")
UNBOXING_CID = cid(b"unboxing")


def _normalize(value, limit=253):
    # Verifier v1.2 normalize(): what a record's domain is stored as and what
    # check_for compares a caller's domain against.
    text = str(value).strip().lower().strip(".")
    return text if len(text) <= limit else ""


class Lacre:
    """Router and Verifier v1.2 stubs. Only LATEST_FINAL sees `final`.

    Records are held typed, as the Verifier's Attestation dataclass holds
    them, and get() returns them in the Verifier's own shape: 18 keys, the
    u256 fields (key_bits, signed_at, fee_paid) as decimal strings, the
    requester as hex. check_for compares as the Verifier does.
    """

    def __init__(self):
        self.router = create_address("lacre-router")
        self.verifier = create_address("lacre-verifier")
        self.names = {"verifier": self.verifier.as_hex}
        self.final = {}
        self.pending = {}
        self.states = []

    def record(self, rid, *, domain="amazon.com", selector="s1", bh="bh1", signed_at=None,
               key_bits=2048, valid=True, aligned=True, final=True):
        held = {
            "domain": _normalize(domain), "selector": _normalize(selector, 63), "bh": bh,
            "body_canon": "relaxed", "message_id_sha256": "00" * 32,
            "key_bits": key_bits, "key_sha256": "11" * 32, "valid": valid,
            "reason": "" if valid else "signature mismatch",
            "from_domain": _normalize(domain) if aligned else "elsewhere.example",
            "aligned": aligned,
            "signed_at": BASE_TS + 10**6 if signed_at is None else signed_at,
            "source": "inline", "requester": create_address("gateway"),
            "attested_at": "2026-10-13T00:00:00Z", "fee_paid": 0,
        }
        (self.final if final else self.pending)[rid] = held
        return held

    @staticmethod
    def get(rid, held):
        if held is None:
            return {}
        return {
            "id": str(rid), "domain": held["domain"], "selector": held["selector"],
            "bh": held["bh"], "body_canon": held["body_canon"],
            "message_id_sha256": held["message_id_sha256"],
            "key_bits": str(held["key_bits"]), "key_sha256": held["key_sha256"],
            "valid": bool(held["valid"]), "reason": held["reason"],
            "from_domain": held["from_domain"], "aligned": bool(held["aligned"]),
            "signed_at": str(held["signed_at"]), "source": held["source"],
            "requester": held["requester"].as_hex, "attested_at": held["attested_at"],
            "fee_paid": str(held["fee_paid"]), "schema_version": "2",
        }

    def check_for(self, held, domain, min_bits, requester):
        try:
            who = type(self.router)(str(requester).strip())
        except Exception:
            return False
        return held is not None and bool(
            held["valid"] and held["aligned"] and held["domain"] == _normalize(domain)
            and int(held["key_bits"]) >= int(min_bits) and held["requester"] == who)

    def call(self, address, method, args, state):
        self.states.append(state)
        records = self.final if state == LATEST_FINAL else {**self.final, **self.pending}
        if address == self.router and method == "resolve":
            return self.names.get(args[0], "")
        if address == self.verifier and method == "get":
            return self.get(args[0], records.get(str(args[0])))
        if address == self.verifier and method == "check_for":
            rid, domain, min_bits, requester = args
            return self.check_for(records.get(str(rid)), domain, min_bits, requester)
        raise LookupError(f"no stub for {method} at {address}")


class World:
    def __init__(self, vm, deploy, set_arbiter=True):
        self.vm = vm
        self.transfers = []
        vm._gl_call_hook = self._hook
        self.at(0)
        vm.sender = create_address("default_sender")
        self.c = deploy(str(SOURCE), router_hex())
        self.lacre = Lacre()
        self.admin = create_address("default_sender")
        self.seller = create_address("seller")
        self.buyer = create_address("buyer")
        self.stranger = create_address("stranger")
        self.arbiter = create_address("arbiter")
        self.zero = type(self.admin)(bytes(20))
        if set_arbiter:
            self.call(self.admin, "set_arbiter", self.arbiter)

    def _hook(self, vm, request):
        from genlayer.py import calldata

        if "EthSend" in request:
            send = request["EthSend"]
            assert send["calldata"] == b""
            self.transfers.append((send["address"], int(send["value"])))
            return b""
        if "CallContract" in request:
            req = request["CallContract"]
            data = req["calldata"]
            try:
                result = self.lacre.call(req["address"], data["method"],
                                         list(data.get("args", [])), req["state"])
            except LookupError as e:
                return bytes([2]) + str(e).encode()
            return bytes([0]) + calldata.encode(result)
        return None

    def at(self, seconds):
        self.now = seconds
        self.vm.warp((BASE + timedelta(seconds=seconds)).isoformat().replace("+00:00", "Z"))

    def call(self, who, method, *args, value=0):
        self.vm.sender = who
        self.vm.value = value
        try:
            return getattr(self.c, method)(*args)
        finally:
            self.vm.value = 0

    @contextmanager
    def refused(self, message):
        before = list(self.transfers)
        with self.vm.expect_revert(message):
            yield
        assert self.transfers == before

    def trade(self, trade_id=0):
        return self.c.get_trade(trade_id)

    def paid_to(self, who):
        return sum(v for a, v in self.transfers if a == who)

    # Builders for a trade in each state.
    def listing(self, price=PRICE, media=LISTING_CID):
        return self.call(self.seller, "create_listing", "Camera", "Body only, tested", price, media)

    def paid(self, **kw):
        tid = self.listing(**kw)
        self.call(self.buyer, "accept_listing", tid, value=int(self.trade(tid)["price"]))
        return tid

    def shipped(self, domains="amazon.com", packing=PACKING_CID, **kw):
        tid = self.paid(**kw)
        self.call(self.seller, "mark_shipped", tid, "1Z999AA10123456784", "UPS", domains, packing)
        return tid

    def disputed(self, kind=NOT_AS_DESCRIBED, media=UNBOXING_CID, **kw):
        tid = self.shipped(**kw)
        self.call(self.buyer, "open_dispute", tid, kind, "Lens is cracked", media,
                  value=BUYER_BOND)
        return tid

    def respond(self, tid):
        self.call(self.seller, "respond_to_dispute", tid, "Packed intact, see photo", "",
                  value=SELLER_BOND)


@pytest.fixture
def w(direct_vm, direct_deploy):
    return World(direct_vm, direct_deploy)


# --- state machine ------------------------------------------------------------

def test_happy_path(w):
    tid = w.listing()
    t = w.trade(tid)
    assert (t["state"], t["listing_media_cid"], t["price"], t["fee_amount"]) == (
        OPEN, LISTING_CID, str(PRICE), str(FEE))
    assert t["seller"] == t["buyer"] == str(w.seller)

    w.at(100)
    w.call(w.buyer, "accept_listing", tid, value=PRICE)
    t = w.trade(tid)
    assert (t["state"], t["buyer"], t["paid_at"]) == (PAID, str(w.buyer), BASE_TS + 100)

    w.at(200)
    w.call(w.seller, "mark_shipped", tid, "1Z999AA10123456784", "UPS", "amazon.com,ups.com",
           PACKING_CID)
    t = w.trade(tid)
    assert (t["state"], t["shipped_at"], t["carrier_domains"], t["packing_media_cid"]) == (
        SHIPPED, BASE_TS + 200, "amazon.com,ups.com", PACKING_CID)
    assert t["claim_at"] == BASE_TS + 200 + DISPUTE_WINDOW

    w.at(300)
    w.call(w.buyer, "confirm_delivery", tid)
    t = w.trade(tid)
    assert (t["state"], t["delivered_at"]) == (COMPLETED, BASE_TS + 300)
    assert w.transfers == [(w.seller, PRICE - FEE)]
    assert w.c.get_contract_info()["fees_collected"] == str(FEE)
    assert w.c.get_eligible(0, 10) == {"total": 1, "ids": [tid]}
    assert t["seller_first_seen"] == BASE_TS and t["buyer_first_seen"] == BASE_TS + 100


def test_create_listing_validation(w):
    for price in (10**15 - 1, 10**30 + 1):
        with w.refused("price"):
            w.call(w.seller, "create_listing", "t", "d", price, "")
    with w.refused("title length"):
        w.call(w.seller, "create_listing", "", "d", PRICE, "")
    with w.refused("title length"):
        w.call(w.seller, "create_listing", "x" * 201, "d", PRICE, "")
    with w.refused("description length"):
        w.call(w.seller, "create_listing", "t", "x" * 2001, PRICE, "")
    with w.refused("cid"):
        w.call(w.seller, "create_listing", "t", "d", PRICE, "bafybeig")
    assert w.c.get_contract_info()["total_trades"] == "0"
    assert w.call(w.seller, "create_listing", "t", "d", 10**15, "") == 0
    assert w.trade(0)["listing_media_cid"] == ""


def test_cancel_listing(w):
    tid = w.listing()
    with w.refused("not seller"):
        w.call(w.buyer, "cancel_listing", tid)
    w.call(w.seller, "cancel_listing", tid)
    assert w.trade(tid)["state"] == CANCELLED
    with w.refused("wrong state"):
        w.call(w.buyer, "accept_listing", tid, value=PRICE)
    tid = w.paid()
    with w.refused("wrong state"):
        w.call(w.seller, "cancel_listing", tid)


def test_accept_payment_must_equal_price(w):
    tid = w.listing()
    for value in (0, PRICE - 1, PRICE + 1, 2 * PRICE):
        with w.refused("payment mismatch"):
            w.call(w.buyer, "accept_listing", tid, value=value)
    assert w.trade(tid)["state"] == OPEN
    with w.refused("own listing"):
        w.call(w.seller, "accept_listing", tid, value=PRICE)
    w.call(w.buyer, "accept_listing", tid, value=PRICE)
    with w.refused("wrong state"):
        w.call(w.stranger, "accept_listing", tid, value=PRICE)


def test_mark_shipped_validation(w):
    tid = w.paid()
    args = ["1Z999AA10123456784", "UPS", "amazon.com", PACKING_CID]

    def ship(who=w.seller, **over):
        a = dict(zip(("tracking", "carrier", "domains", "cid"), args), **over)
        w.call(who, "mark_shipped", tid, a["tracking"], a["carrier"], a["domains"], a["cid"])

    with w.refused("not seller"):
        ship(w.buyer)
    with w.refused("tracking length"):
        ship(tracking="abc")
    with w.refused("tracking length"):
        ship(tracking="x" * 101)
    with w.refused("carrier length"):
        ship(carrier="")
    for domains in ("usps.com", "amazon.com,", "amazon.com, ups.com", "AMAZON.COM",
                    "amazon.com,ups.com,fedex.com,dhl.com"):
        with w.refused("carrier domain"):
            ship(domains=domains)
    assert w.trade(tid)["state"] == PAID
    ship(domains="amazon.com,ups.com,fedex.com", cid="")
    t = w.trade(tid)
    assert (t["state"], t["carrier_domains"], t["packing_media_cid"]) == (
        SHIPPED, "amazon.com,ups.com,fedex.com", "")
    with w.refused("wrong state"):
        ship()


BAD_CIDS = [
    "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",       # CIDv0
    cid(b"x", header=b"\x01\x70\x12\x20"),                  # dag-pb, bafybei
    cid(b"x", header=b"\x01\x55\x13\x40")[:59],             # sha2-512
    cid(b"x").upper(),                                      # base32 upper
    "B" + cid(b"x")[1:],                                    # multibase prefix
    cid(b"x")[:-1],                                         # short
    cid(b"x") + "a",                                        # long
    cid(b"x")[:20] + "1" + cid(b"x")[21:],                  # outside the alphabet
    cid(b"x")[:20] + "=" + cid(b"x")[21:],
    " " + cid(b"x")[1:],
]


def _non_canonical(c):
    # The last base32 character carries two padding bits; flipping one
    # decodes to the same bytes under a different spelling.
    alphabet = "abcdefghijklmnopqrstuvwxyz234567"
    return c[:-1] + alphabet[alphabet.index(c[-1]) ^ 1]


def test_cid_shape_on_mark_shipped(w):
    tid = w.paid()
    variant = _non_canonical(cid(b"x"))
    assert base64.b32decode(variant[1:].upper() + "======") == base64.b32decode(
        cid(b"x")[1:].upper() + "======")
    for bad in BAD_CIDS + [variant]:
        with w.refused("cid"):
            w.call(w.seller, "mark_shipped", tid, "TRACK123", "UPS", "", bad)
    assert w.trade(tid)["state"] == PAID
    w.call(w.seller, "mark_shipped", tid, "TRACK123", "UPS", "", cid(b"x"))
    assert w.trade(tid)["packing_media_cid"] == cid(b"x")


def test_confirm_delivery_guards(w):
    tid = w.paid()
    with w.refused("wrong state"):
        w.call(w.buyer, "confirm_delivery", tid)
    w.call(w.seller, "mark_shipped", tid, "TRACK123", "UPS", "", "")
    with w.refused("not buyer"):
        w.call(w.seller, "confirm_delivery", tid)
    with w.refused("not buyer"):
        w.call(w.stranger, "confirm_delivery", tid)


def test_claim_after_window(w):
    tid = w.shipped()
    w.at(DISPUTE_WINDOW - 1)
    with w.refused("dispute window open"):
        w.call(w.seller, "claim_after_window", tid)
    w.at(DISPUTE_WINDOW)
    with w.refused("not seller"):
        w.call(w.buyer, "claim_after_window", tid)
    w.call(w.seller, "claim_after_window", tid)
    t = w.trade(tid)
    assert (t["state"], t["delivered_at"]) == (COMPLETED, BASE_TS + DISPUTE_WINDOW)
    assert w.transfers == [(w.seller, PRICE - FEE)]
    with w.refused("wrong state"):
        w.call(w.seller, "claim_after_window", tid)


def test_claim_unshipped_refund(w):
    tid = w.paid()
    w.at(MAX_SHIPPING_DELAY - 1)
    with w.refused("shipping window open"):
        w.call(w.buyer, "claim_unshipped_refund", tid)
    w.at(MAX_SHIPPING_DELAY)
    with w.refused("not buyer"):
        w.call(w.seller, "claim_unshipped_refund", tid)
    w.call(w.buyer, "claim_unshipped_refund", tid)
    assert w.trade(tid)["state"] == REFUNDED
    assert w.transfers == [(w.buyer, PRICE)]
    assert w.c.get_eligible(0, 10)["total"] == 0
    with w.refused("wrong state"):
        w.call(w.seller, "mark_shipped", tid, "TRACK123", "UPS", "", "")


def test_unshipped_refund_only_before_shipping(w):
    tid = w.shipped()
    w.at(MAX_SHIPPING_DELAY)
    with w.refused("wrong state"):
        w.call(w.buyer, "claim_unshipped_refund", tid)


# --- unboxing media -----------------------------------------------------------

def test_set_unboxing_media_after_delivery(w):
    tid = w.shipped()
    with w.refused("wrong state"):
        w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)
    w.at(50)
    w.call(w.buyer, "confirm_delivery", tid)
    with w.refused("not buyer"):
        w.call(w.seller, "set_unboxing_media", tid, UNBOXING_CID)
    for bad in BAD_CIDS + [_non_canonical(UNBOXING_CID), ""]:
        with w.refused("cid"):
            w.call(w.buyer, "set_unboxing_media", tid, bad)
    w.at(50 + UNBOXING_WINDOW - 1)
    w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)
    assert w.trade(tid)["unboxing_media_cid"] == UNBOXING_CID
    with w.refused("cid"):
        w.call(w.buyer, "set_unboxing_media", tid, cid(b"other"))
    assert w.transfers == [(w.seller, PRICE - FEE)]


def test_set_unboxing_media_window_closes(w):
    tid = w.shipped()
    w.at(50)
    w.call(w.buyer, "confirm_delivery", tid)
    w.at(50 + UNBOXING_WINDOW)
    with w.refused("unboxing window closed"):
        w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)


def test_set_unboxing_media_during_dispute(w):
    tid = w.disputed(kind=DAMAGED, media="")
    disputed_at = w.now
    w.at(disputed_at + UNBOXING_WINDOW)
    with w.refused("unboxing window closed"):
        w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)
    w.at(disputed_at + UNBOXING_WINDOW - 1)
    w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)
    assert w.trade(tid)["unboxing_media_cid"] == UNBOXING_CID


def test_set_unboxing_media_closed_after_verdict(w):
    tid = w.disputed(kind=DAMAGED, media="")
    w.call(w.arbiter, "settle", tid, False, HASH)
    with w.refused("wrong state"):
        w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)


# --- disputes -----------------------------------------------------------------

def test_open_dispute_records_the_claim(w):
    tid = w.shipped()
    w.at(10)
    w.call(w.buyer, "open_dispute", tid, DAMAGED, "Arrived crushed", UNBOXING_CID,
           value=BUYER_BOND)
    t = w.trade(tid)
    assert (t["state"], t["claim_kind"], t["buyer_evidence"], t["buyer_bond"],
            t["unboxing_media_cid"], t["disputed_at"], t["was_disputed"], t["responded"]) == (
        DISPUTED, DAMAGED, "Arrived crushed", str(BUYER_BOND), UNBOXING_CID, BASE_TS + 10,
        True, False)


def test_open_dispute_window(w):
    tid = w.shipped()
    w.at(DISPUTE_WINDOW)
    with w.refused("dispute window closed"):
        w.call(w.buyer, "open_dispute", tid, DAMAGED, "late", "", value=BUYER_BOND)
    w.at(DISPUTE_WINDOW - 1)
    w.call(w.buyer, "open_dispute", tid, DAMAGED, "just in time", "", value=BUYER_BOND)
    assert w.trade(tid)["state"] == DISPUTED


def test_open_dispute_refusals(w):
    tid = w.shipped()

    def dispute(who=w.buyer, kind=DAMAGED, statement="bad", media="", value=BUYER_BOND):
        w.call(who, "open_dispute", tid, kind, statement, media, value=value)

    with w.refused("not buyer"):
        dispute(who=w.seller)
    with w.refused("not buyer"):
        dispute(who=w.stranger)
    for value in (0, BUYER_BOND - 1, BUYER_BOND + 1, SELLER_BOND):
        with w.refused("bond"):
            dispute(value=value)
    for kind in (0, 4, 255):
        with w.refused("claim kind"):
            dispute(kind=kind)
    for statement in ("", "x" * 2001):
        with w.refused("statement length"):
            dispute(statement=statement)
    with w.refused("cid"):
        dispute(media=BAD_CIDS[1])
    t = w.trade(tid)
    assert (t["state"], t["buyer_bond"], t["buyer_evidence"], t["claim_kind"]) == (
        SHIPPED, "0", "", 0)
    dispute(statement="x" * 2000)
    with w.refused("wrong state"):
        dispute()


def test_open_dispute_needs_shipped(w):
    tid = w.paid()
    with w.refused("wrong state"):
        w.call(w.buyer, "open_dispute", tid, NOT_RECEIVED, "where", "", value=BUYER_BOND)


def test_respond_to_dispute(w):
    tid = w.disputed()
    w.at(w.now + 5)
    for value in (0, SELLER_BOND - 1, SELLER_BOND + 1, BUYER_BOND):
        with w.refused("bond"):
            w.call(w.seller, "respond_to_dispute", tid, "fine", "", value=value)
    with w.refused("not seller"):
        w.call(w.buyer, "respond_to_dispute", tid, "fine", "", value=SELLER_BOND)
    with w.refused("statement length"):
        w.call(w.seller, "respond_to_dispute", tid, "", "", value=SELLER_BOND)
    with w.refused("cid"):
        w.call(w.seller, "respond_to_dispute", tid, "fine", "bafy", value=SELLER_BOND)
    assert w.trade(tid)["responded"] is False
    reply = cid(b"reply")
    w.call(w.seller, "respond_to_dispute", tid, "Packed intact", reply, value=SELLER_BOND)
    t = w.trade(tid)
    assert (t["state"], t["responded"], t["seller_evidence"], t["seller_response_cid"],
            t["seller_bond"]) == (DISPUTED, True, "Packed intact", reply, str(SELLER_BOND))
    with w.refused("already responded"):
        w.call(w.seller, "respond_to_dispute", tid, "again", "", value=SELLER_BOND)


def test_seller_bond_is_five_percent_of_price(w):
    price = 3 * 10**17 + 7
    tid = w.disputed(price=price)
    bond = price * 500 // 10000
    with w.refused("bond"):
        w.call(w.seller, "respond_to_dispute", tid, "ok", "", value=bond + 1)
    w.call(w.seller, "respond_to_dispute", tid, "ok", "", value=bond)
    assert w.trade(tid)["seller_bond"] == str(bond)


def test_respond_after_window(w):
    tid = w.disputed()
    w.at(w.now + RESPONSE_WINDOW)
    with w.refused("response window closed"):
        w.respond(tid)


def test_respond_needs_dispute(w):
    tid = w.shipped()
    with w.refused("wrong state"):
        w.respond(tid)


# --- settle -------------------------------------------------------------------

def test_settle_only_from_arbiter(w):
    tid = w.disputed()
    w.respond(tid)
    for who in (w.buyer, w.seller, w.admin, w.stranger, w.lacre.router):
        with w.refused("not arbiter"):
            w.call(who, "settle", tid, True, HASH)
    assert w.trade(tid)["state"] == DISPUTED


def test_settle_refused_before_arbiter_is_set(direct_vm, direct_deploy):
    w = World(direct_vm, direct_deploy, set_arbiter=False)
    tid = w.disputed()
    for who in (w.zero, w.arbiter, w.admin):
        with w.refused("not arbiter"):
            w.call(who, "settle", tid, True, HASH)
    assert w.c.get_contract_info()["arbiter"] == str(w.zero)


def test_settle_buyer_wins(w):
    tid = w.disputed()
    w.respond(tid)
    with w.refused("hash length"):
        w.call(w.arbiter, "settle", tid, True, "ab")
    w.call(w.arbiter, "settle", tid, True, HASH)
    t = w.trade(tid)
    assert (t["state"], t["buyer_wins"], t["verdict_hash"], t["resolved_by_default"]) == (
        COMPLETED, True, HASH, False)
    assert w.transfers == [(w.buyer, PRICE + BUYER_BOND + SELLER_BOND)]
    assert w.c.get_contract_info()["fees_collected"] == "0"
    assert w.c.get_eligible(0, 10)["total"] == 0


def test_settle_seller_wins(w):
    tid = w.disputed()
    w.respond(tid)
    w.call(w.arbiter, "settle", tid, False, HASH)
    t = w.trade(tid)
    assert (t["state"], t["buyer_wins"]) == (COMPLETED, False)
    assert w.transfers == [(w.seller, PRICE - FEE + BUYER_BOND + SELLER_BOND)]
    assert w.c.get_contract_info()["fees_collected"] == str(FEE)
    assert w.c.get_eligible(0, 10)["ids"] == [tid]


def test_settle_without_response_by_rule(w):
    # A burden rule can decide before the seller answers; the Arbiter emits
    # settle and the seller's side carries no bond.
    tid = w.disputed(kind=NOT_AS_DESCRIBED, media=UNBOXING_CID, )
    w.call(w.arbiter, "settle", tid, True, HASH)
    assert w.transfers == [(w.buyer, PRICE + BUYER_BOND)]


def test_settle_twice_refused(w):
    tid = w.disputed()
    w.call(w.arbiter, "settle", tid, False, HASH)
    with w.refused("wrong state"):
        w.call(w.arbiter, "settle", tid, True, HASH)
    assert len(w.transfers) == 1


def test_settle_refused_without_open_dispute(w):
    for tid in (w.listing(), w.paid(), w.shipped()):
        with w.refused("wrong state"):
            w.call(w.arbiter, "settle", tid, True, HASH)
    tid = w.shipped()
    w.call(w.buyer, "confirm_delivery", tid)
    with w.refused("wrong state"):
        w.call(w.arbiter, "settle", tid, True, HASH)


# --- default judgment ---------------------------------------------------------

def test_default_judgment_pays_buyer_minus_penalty(w):
    tid = w.disputed(kind=NOT_AS_DESCRIBED, media=UNBOXING_CID)
    start = w.now
    w.at(start + RESPONSE_WINDOW - 1)
    with w.refused("response window open"):
        w.call(w.buyer, "claim_dispute_default", tid)
    w.at(start + RESPONSE_WINDOW)
    with w.refused("not buyer"):
        w.call(w.seller, "claim_dispute_default", tid)
    with w.refused("not buyer"):
        w.call(w.stranger, "claim_dispute_default", tid)
    w.call(w.buyer, "claim_dispute_default", tid)
    t = w.trade(tid)
    assert (t["state"], t["buyer_wins"], t["resolved_by_default"]) == (COMPLETED, True, True)
    assert w.transfers == [(w.buyer, PRICE + BUYER_BOND - PENALTY)]
    assert w.c.get_contract_info()["fees_collected"] == str(PENALTY)
    with w.refused("wrong state"):
        w.call(w.buyer, "claim_dispute_default", tid)


def test_default_blocked_by_response(w):
    tid = w.disputed()
    w.respond(tid)
    w.at(w.now + RESPONSE_WINDOW)
    with w.refused("responded"):
        w.call(w.buyer, "claim_dispute_default", tid)


def test_default_not_received_without_proof(w):
    tid = w.disputed(kind=NOT_RECEIVED, media="")
    w.at(w.now + RESPONSE_WINDOW)
    w.call(w.buyer, "claim_dispute_default", tid)
    assert w.transfers == [(w.buyer, PRICE + BUYER_BOND - PENALTY)]


def test_default_refused_by_r1_proof(w):
    tid = w.disputed(kind=NOT_RECEIVED, media="")
    w.lacre.record("7")
    w.call(w.seller, "submit_delivery_proof", tid, "7")
    w.at(w.now + RESPONSE_WINDOW)
    with w.refused("burden not met"):
        w.call(w.buyer, "claim_dispute_default", tid)
    assert w.trade(tid)["state"] == DISPUTED


@pytest.mark.parametrize("kind", [DAMAGED, NOT_AS_DESCRIBED])
def test_default_refused_by_r2_no_unboxing(w, kind):
    tid = w.disputed(kind=kind, media="")
    w.at(w.now + RESPONSE_WINDOW)
    with w.refused("burden not met"):
        w.call(w.buyer, "claim_dispute_default", tid)


def test_default_after_late_unboxing(w):
    tid = w.disputed(kind=DAMAGED, media="")
    start = w.now
    w.at(start + 1)
    w.call(w.buyer, "set_unboxing_media", tid, UNBOXING_CID)
    w.at(start + RESPONSE_WINDOW)
    w.call(w.buyer, "claim_dispute_default", tid)
    assert w.trade(tid)["state"] == COMPLETED


# --- stuck disputes -----------------------------------------------------------

def test_admin_force_refund(w):
    price = PRICE + 1
    tid = w.disputed(price=price)
    w.call(w.seller, "respond_to_dispute", tid, "no", "", value=price * 500 // 10000)
    start = w.now
    w.at(start + ADMIN_DELAY - 1)
    with w.refused("delay pending"):
        w.call(w.admin, "force_refund_stuck_dispute", tid)
    w.at(start + ADMIN_DELAY)
    with w.refused("not admin"):
        w.call(w.buyer, "force_refund_stuck_dispute", tid)
    w.call(w.admin, "force_refund_stuck_dispute", tid)
    half = price // 2
    assert w.trade(tid)["state"] == REFUNDED
    assert w.transfers == [(w.buyer, half + BUYER_BOND),
                           (w.seller, price - half + price * 500 // 10000)]
    with w.refused("wrong state"):
        w.call(w.admin, "force_refund_stuck_dispute", tid)


def test_public_stuck_refund(w):
    tid = w.disputed()
    start = w.now
    w.at(start + PUBLIC_DELAY - 1)
    with w.refused("delay pending"):
        w.call(w.stranger, "claim_stuck_dispute_refund", tid)
    w.at(start + PUBLIC_DELAY)
    w.call(w.stranger, "claim_stuck_dispute_refund", tid)
    assert w.transfers == [(w.buyer, PRICE // 2 + BUYER_BOND), (w.seller, PRICE - PRICE // 2)]
    with w.refused("wrong state"):
        w.call(w.arbiter, "settle", tid, True, HASH)


def test_stuck_refund_needs_dispute(w):
    tid = w.shipped()
    w.at(PUBLIC_DELAY)
    with w.refused("wrong state"):
        w.call(w.stranger, "claim_stuck_dispute_refund", tid)
    with w.refused("wrong state"):
        w.call(w.admin, "force_refund_stuck_dispute", tid)


# --- pause and admin ----------------------------------------------------------

def test_pause_blocks_entry_writes(w):
    shipped = w.shipped()
    paid = w.paid()
    open_ = w.listing()
    with w.refused("not admin"):
        w.call(w.seller, "pause")
    w.call(w.admin, "pause")
    assert w.c.get_contract_info()["paused"] is True
    with w.refused("paused"):
        w.listing()
    with w.refused("paused"):
        w.call(w.seller, "cancel_listing", open_)
    with w.refused("paused"):
        w.call(w.buyer, "accept_listing", open_, value=PRICE)
    with w.refused("paused"):
        w.call(w.seller, "mark_shipped", paid, "TRACK123", "UPS", "", "")
    with w.refused("paused"):
        w.call(w.buyer, "open_dispute", shipped, DAMAGED, "x", "", value=BUYER_BOND)
    # Exits stay open while paused, so a pause cannot trap money.
    w.call(w.buyer, "confirm_delivery", shipped)
    with w.refused("not admin"):
        w.call(w.seller, "unpause")
    w.call(w.admin, "unpause")
    w.call(w.buyer, "accept_listing", open_, value=PRICE)
    w.call(w.seller, "mark_shipped", paid, "TRACK123", "UPS", "", "")
    assert w.listing() == 3


def test_admin_transfer(w):
    with w.refused("not admin"):
        w.call(w.stranger, "transfer_admin", w.stranger)
    zero = w.zero
    for bad in (zero, w.admin):
        with w.refused("bad address"):
            w.call(w.admin, "transfer_admin", bad)
    with w.refused("no pending admin"):
        w.call(w.admin, "cancel_pending_admin")
    w.call(w.admin, "transfer_admin", w.stranger)
    w.call(w.admin, "cancel_pending_admin")
    with w.refused("not pending admin"):
        w.call(w.stranger, "accept_admin")
    w.call(w.admin, "transfer_admin", w.stranger)
    with w.refused("not pending admin"):
        w.call(w.buyer, "accept_admin")
    w.call(w.stranger, "accept_admin")
    info = w.c.get_contract_info()
    assert (info["admin"], info["pending_admin"]) == (str(w.stranger), str(zero))
    with w.refused("not admin"):
        w.call(w.admin, "pause")
    w.call(w.stranger, "pause")


def test_set_arbiter_is_one_shot(direct_vm, direct_deploy):
    w = World(direct_vm, direct_deploy, set_arbiter=False)
    with w.refused("not admin"):
        w.call(w.stranger, "set_arbiter", w.arbiter)
    with w.refused("bad address"):
        w.call(w.admin, "set_arbiter", w.zero)
    w.call(w.admin, "set_arbiter", w.arbiter)
    assert w.c.get_contract_info()["arbiter"] == str(w.arbiter)
    with w.refused("arbiter set"):
        w.call(w.admin, "set_arbiter", create_address("other"))
    assert w.c.get_contract_info()["arbiter"] == str(w.arbiter)


def test_constructor_router(direct_vm, direct_deploy):
    direct_vm.sender = create_address("default_sender")
    c = direct_deploy(str(SOURCE))
    assert c.get_contract_info()["router"].lower() ==         "0xef37cb72c3a9dd6bce2f3575b75c94c555f9c8d9"


def test_withdraw_fees(w):
    tid = w.shipped()
    w.call(w.buyer, "confirm_delivery", tid)
    w.transfers.clear()
    zero = w.zero
    with w.refused("not admin"):
        w.call(w.stranger, "withdraw_fees", w.stranger, 1)
    for amount in (0, FEE + 1):
        with w.refused("amount"):
            w.call(w.admin, "withdraw_fees", w.admin, amount)
    with w.refused("bad address"):
        w.call(w.admin, "withdraw_fees", zero, 1)
    w.call(w.admin, "withdraw_fees", w.stranger, FEE - 1)
    w.call(w.admin, "withdraw_fees", w.admin, 1)
    assert w.transfers == [(w.stranger, FEE - 1), (w.admin, 1)]
    assert w.c.get_contract_info()["fees_collected"] == "0"


def test_upgrade_timelock(w):
    with w.refused("not admin"):
        w.call(w.stranger, "propose_upgrade", b"code")
    with w.refused("empty code"):
        w.call(w.admin, "propose_upgrade", b"")
    with w.refused("no pending upgrade"):
        w.call(w.admin, "execute_upgrade")
    with w.refused("no pending upgrade"):
        w.call(w.admin, "cancel_pending_upgrade")
    w.at(1000)
    w.call(w.admin, "propose_upgrade", b"new code")
    info = w.c.get_contract_info()
    assert (info["has_pending_upgrade"], info["upgrade_unlock_at"]) == (
        True, BASE_TS + 1000 + UPGRADE_TIMELOCK)
    w.call(w.admin, "cancel_pending_upgrade")
    assert w.c.get_contract_info()["has_pending_upgrade"] is False
    w.call(w.admin, "propose_upgrade", b"new code")
    w.at(1000 + UPGRADE_TIMELOCK - 1)
    with w.refused("timelock pending"):
        w.call(w.admin, "execute_upgrade")
    with w.refused("not admin"):
        w.call(w.stranger, "execute_upgrade")
    w.at(1000 + UPGRADE_TIMELOCK)
    w.call(w.admin, "execute_upgrade")
    info = w.c.get_contract_info()
    assert (info["has_pending_upgrade"], info["upgrade_unlock_at"]) == (False, 0)


# --- delivery proof -----------------------------------------------------------

VERIFIER_GET_KEYS = {
    "id", "domain", "selector", "bh", "body_canon", "message_id_sha256", "key_bits",
    "key_sha256", "valid", "reason", "from_domain", "aligned", "signed_at", "source",
    "requester", "attested_at", "fee_paid", "schema_version",
}


def test_stub_record_has_the_verifier_shape(w):
    # lacre contracts/verifier/verifier.py, get(): the proof path must be
    # tested against the record as the Verifier returns it.
    w.lacre.record("9")
    rec = w.lacre.call(w.lacre.verifier, "get", ["9"], LATEST_FINAL)
    assert set(rec) == VERIFIER_GET_KEYS and len(rec) == 18
    for key in ("key_bits", "signed_at", "fee_paid"):
        assert isinstance(rec[key], str) and rec[key].isdigit(), key
    assert isinstance(rec["valid"], bool) and isinstance(rec["aligned"], bool)
    assert w.lacre.call(w.lacre.verifier, "check_for",
                        ["9", " Amazon.COM. ", 1024, rec["requester"].lower()], LATEST_FINAL)
    assert not w.lacre.call(w.lacre.verifier, "check_for",
                            ["9", "amazon.com", 1024, "not an address"], LATEST_FINAL)


def test_delivery_proof_accepted(w):
    tid = w.shipped(domains="ups.com,amazon.com")
    w.lacre.record("12", key_bits=1024)
    w.at(77)
    with w.refused("not seller"):
        w.call(w.buyer, "submit_delivery_proof", tid, "12")
    w.call(w.seller, "submit_delivery_proof", tid, " 12 ")
    t = w.trade(tid)
    assert (t["delivery_proof"], t["proof_kind"], t["proof_at"]) == ("12", "dkim", BASE_TS + 77)
    assert set(w.lacre.states) == {LATEST_FINAL}
    w.lacre.record("13", bh="bh2")
    with w.refused("proof set"):
        w.call(w.seller, "submit_delivery_proof", tid, "13")


def _assert_no_proof(w, tid):
    t = w.trade(tid)
    assert (t["delivery_proof"], t["proof_kind"], t["proof_at"]) == ("", "", 0)


@pytest.mark.parametrize("record", [
    dict(domain="ups.com"),
    dict(key_bits=1023),
    dict(valid=False),
    dict(aligned=False),
    dict(signed_at=BASE_TS),
    dict(signed_at=BASE_TS - 1),
    dict(final=False),
], ids=["wrong-domain", "key-1023", "invalid", "not-aligned", "signed-at-paid-at",
        "signed-before-paid", "not-final"])
def test_delivery_proof_refused(w, record):
    tid = w.shipped(domains="amazon.com")
    assert w.trade(tid)["paid_at"] == BASE_TS
    w.lacre.record("5", **record)
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", tid, "5")
    _assert_no_proof(w, tid)
    assert set(w.lacre.states) == {LATEST_FINAL}


def test_delivery_proof_unknown_record_or_router(w):
    tid = w.shipped()
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", tid, "404")
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", tid, "")
    w.lacre.record("5")
    w.lacre.names = {}
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", tid, "5")
    w.lacre.names = {"verifier": create_address("elsewhere").as_hex}
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", tid, "5")
    _assert_no_proof(w, tid)


def test_delivery_proof_needs_listed_domain(w):
    tid = w.shipped(domains="")
    w.lacre.record("5")
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", tid, "5")


def test_delivery_proof_one_email_one_trade(w):
    first = w.shipped()
    second = w.shipped()
    w.lacre.record("1")
    w.call(w.seller, "submit_delivery_proof", first, "1")
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", second, "1")
    # The same signed email attested again is a new record with the same
    # signed values, and is refused as well.
    w.lacre.record("2")
    with w.refused("no accepted attestation"):
        w.call(w.seller, "submit_delivery_proof", second, "2")
    _assert_no_proof(w, second)
    w.lacre.record("3", bh="bh-other")
    w.call(w.seller, "submit_delivery_proof", second, "3")
    assert w.trade(second)["delivery_proof"] == "3"


def test_delivery_proof_states(w):
    tid = w.paid()
    w.lacre.record("1")
    with w.refused("wrong state"):
        w.call(w.seller, "submit_delivery_proof", tid, "1")
    tid = w.disputed(kind=NOT_RECEIVED, media="")
    w.call(w.seller, "submit_delivery_proof", tid, "1")
    assert w.trade(tid)["proof_kind"] == "dkim"
    w.call(w.arbiter, "settle", tid, False, HASH)
    w.lacre.record("2", bh="x")
    with w.refused("wrong state"):
        w.call(w.seller, "submit_delivery_proof", tid, "2")


def test_proof_shortens_the_claim_window(w):
    tid = w.shipped()
    proof_at = 100
    w.lacre.record("1")
    w.at(proof_at)
    w.call(w.seller, "submit_delivery_proof", tid, "1")
    claim_at = min(DISPUTE_WINDOW, proof_at + PROOF_CLAIM_DELAY)
    assert claim_at < DISPUTE_WINDOW
    assert w.trade(tid)["claim_at"] == BASE_TS + claim_at
    w.at(claim_at - 1)
    with w.refused("dispute window open"):
        w.call(w.seller, "claim_after_window", tid)
    snap = w.vm.snapshot()
    w.call(w.buyer, "open_dispute", tid, DAMAGED, "x", "", value=BUYER_BOND)
    w.vm.revert(snap)
    w.at(claim_at)
    with w.refused("dispute window closed"):
        w.call(w.buyer, "open_dispute", tid, DAMAGED, "x", "", value=BUYER_BOND)
    w.call(w.seller, "claim_after_window", tid)
    assert w.transfers == [(w.seller, PRICE - FEE)]


def test_late_proof_keeps_the_base_window(w):
    tid = w.shipped()
    w.lacre.record("1")
    w.at(DISPUTE_WINDOW - 10)
    w.call(w.seller, "submit_delivery_proof", tid, "1")
    assert w.trade(tid)["claim_at"] == BASE_TS + DISPUTE_WINDOW
    w.at(DISPUTE_WINDOW - 1)
    with w.refused("dispute window open"):
        w.call(w.seller, "claim_after_window", tid)


# --- views --------------------------------------------------------------------

ARBITER_VIEW = {
    "state": int, "claim_kind": int, "proof_kind": str, "delivery_proof": str,
    "listing_title": str, "listing_description": str, "listing_media_cid": str,
    "packing_media_cid": str, "unboxing_media_cid": str, "seller_response_cid": str,
    "buyer_evidence": str, "seller_evidence": str, "responded": bool,
    "created_at": int, "paid_at": int, "shipped_at": int, "delivered_at": int,
    "disputed_at": int, "proof_at": int, "claim_at": int, "response_until": int,
    "unboxing_until": int, "price": str, "fee_amount": str,
    "buyer_bond": str, "seller_bond": str, "seller": str, "buyer": str,
    "carrier_domains": str, "verdict_hash": str, "was_disputed": bool,
    "buyer_wins": bool, "resolved_by_default": bool, "trade_id": str,
    "tracking_number": str, "tracking_carrier": str,
    "buyer_first_seen": int, "seller_first_seen": int,
}


def test_get_trade_shape(w):
    tid = w.disputed()
    w.respond(tid)
    t = w.trade(tid)
    assert set(t) == set(ARBITER_VIEW)
    for key, typ in ARBITER_VIEW.items():
        assert isinstance(t[key], typ), key
        if typ is int:
            assert not isinstance(t[key], bool), key


def test_get_trade_dispute_deadlines(w):
    # The Arbiter reads its windows here, so it carries no constants of its own.
    tid = w.shipped()
    t = w.trade(tid)
    assert (t["response_until"], t["unboxing_until"]) == (0, 0)
    w.at(10)
    w.call(w.buyer, "open_dispute", tid, DAMAGED, "Arrived crushed", "", value=BUYER_BOND)
    t = w.trade(tid)
    assert t["response_until"] == BASE_TS + 10 + RESPONSE_WINDOW
    assert t["unboxing_until"] == BASE_TS + 10 + UNBOXING_WINDOW


def test_get_eligible_slice(w):
    ids = []
    for _ in range(3):
        tid = w.shipped()
        w.call(w.buyer, "confirm_delivery", tid)
        ids.append(tid)
    assert w.c.get_eligible(0, 10) == {"total": 3, "ids": ids}
    assert w.c.get_eligible(1, 1) == {"total": 3, "ids": ids[1:2]}
    assert w.c.get_eligible(5, 10) == {"total": 3, "ids": []}
    assert w.c.get_eligible(-3, 2) == {"total": 3, "ids": ids[:2]}
    assert w.c.get_eligible(0, -1) == {"total": 3, "ids": []}


def test_get_contract_info(w):
    info = w.c.get_contract_info()
    assert info["carrier_domains"] == ["amazon.com", "ups.com", "fedex.com", "dhl.com"]
    assert info["arbiter"] == str(w.arbiter)
    assert info["router"] == str(w.lacre.router)
    assert info["version"] == K["VERSION"]
    assert (info["paused"], info["total_trades"], info["fees_collected"]) == (False, "0", "0")


# --- money is conserved -------------------------------------------------------

def test_every_path_pays_out_what_came_in(w):
    """price plus bonds in, transfers plus fee out, for every terminal path."""
    def settle_out(tid, deposits):
        paid = sum(v for _, v in w.transfers)
        fees = int(w.c.get_contract_info()["fees_collected"])
        assert paid + fees == deposits, tid

    cases = []
    tid = w.shipped(); w.call(w.buyer, "confirm_delivery", tid); cases.append(PRICE)
    tid = w.paid(); w.at(w.now + MAX_SHIPPING_DELAY)
    w.call(w.buyer, "claim_unshipped_refund", tid); cases.append(PRICE)
    tid = w.disputed(); w.respond(tid); w.call(w.arbiter, "settle", tid, True, HASH)
    cases.append(PRICE + BUYER_BOND + SELLER_BOND)
    tid = w.disputed(); w.respond(tid); w.call(w.arbiter, "settle", tid, False, HASH)
    cases.append(PRICE + BUYER_BOND + SELLER_BOND)
    tid = w.disputed(); w.at(w.now + RESPONSE_WINDOW)
    w.call(w.buyer, "claim_dispute_default", tid); cases.append(PRICE + BUYER_BOND)
    tid = w.disputed(); w.respond(tid); w.at(w.now + PUBLIC_DELAY)
    w.call(w.stranger, "claim_stuck_dispute_refund", tid)
    cases.append(PRICE + BUYER_BOND + SELLER_BOND)
    settle_out(tid, sum(cases))
