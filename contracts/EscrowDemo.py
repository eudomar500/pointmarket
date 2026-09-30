# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from genlayer.py.public_abi import StorageType
from dataclasses import dataclass, fields
from datetime import datetime, timezone
import base64

VERSION = u16(950)

DISPUTE_WINDOW = 3600
PROOF_CLAIM_DELAY = 600
UNBOXING_WINDOW = 24 * 3600
DISPUTE_RESPONSE_WINDOW = 3600
MAX_SHIPPING_DELAY = 3600
ADMIN_FORCE_REFUND_DELAY = 7200
PUBLIC_FORCE_REFUND_DELAY = 10800
UPGRADE_TIMELOCK = 300

OPEN = 0
PAID = 1
SHIPPED = 2
DISPUTED = 3
COMPLETED = 4
CANCELLED = 5
REFUNDED = 6

NOT_RECEIVED = 1
DAMAGED = 2
NOT_AS_DESCRIBED = 3

FEE_BPS = 200
SELLER_BOND_BPS = 500
PENALTY_BPS = 500
BPS = 10000
BUYER_BOND = 10**16
MIN_PRICE = 10**15
MAX_PRICE = 10**30

# The amazon.com key is 1024 bits today; a higher floor refuses every record.
MIN_KEY_BITS = 1024
# A constant, not an admin list, to stay under the deploy gas cap; a new
# carrier domain means an upgrade.
CARRIER_DOMAINS = ("amazon.com", "ups.com", "fedex.com", "dhl.com")
ROUTER = "0xEf37cb72C3A9dD6bCE2f3575B75c94C555F9c8d9"
ZERO = Address("0x" + "00" * 20)


def _fail(msg: str):
    raise gl.vm.UserError("[EXPECTED] " + msg)


def _len(s: str, lo: int, hi: int, what: str) -> None:
    if not lo <= len(s) <= hi:
        _fail(what + " length")


def _cid(c: str) -> None:
    # Raw CIDv1 over sha2-256 only: its digest is the sha256 of the file, so
    # the jury can check gateway bytes against it. Re-encoding the decoded
    # bytes refuses upper case and non-canonical trailing bits, so one file
    # has exactly one accepted spelling.
    if c == "":
        return
    try:
        raw = base64.b32decode(c[1:].upper() + "======")
    except Exception:
        raw = b""
    if (len(c) != 59 or c[0] != "b" or len(raw) != 36 or raw[:4] != b"\x01\x55\x12\x20"
            or base64.b32encode(raw).decode().lower()[:58] != c[1:]):
        _fail("cid")


# integrate:begin
def final(address):
    # A record read before FINALIZED can still be appealed away (rule 1), so
    # nothing here reads any other state.
    return gl.get_contract_at(address).view(state=StorageType.LATEST_FINAL)


def resolved(router, name):
    # Resolved on every use and never stored: when the Router moves a name
    # after its 48 hour notice, this contract follows without a redeploy.
    found = str(final(router).resolve(name))
    return Address(found) if found else None


def attested(router, record_id, domain, min_key_bits):
    """(Verifier, record) for a record that passes check_for, or (None, {}).

    Never raises: an unreadable Router or Verifier reads as no attestation.
    """
    try:
        verifier = resolved(router, "verifier")
        if verifier is None:
            return None, {}
        record = dict(final(verifier).get(record_id))
        if not record:
            return None, {}
        # check_for binds a requester. This app accepts a record whoever paid
        # for it, since the requester proves nothing about who received the
        # message (rule 6), so the record's own is passed and the Verifier's
        # own comparisons decide validity, alignment, domain and key size
        # (rule 3). An app that pays out to the requester passes its own.
        ok = final(verifier).check_for(record_id, str(domain), int(min_key_bits),
                                       str(record.get("requester", "")))
        return (verifier, record) if ok is True else (None, {})
    except Exception:
        return None, {}
# integrate:end


@gl.evm.contract_interface
class _EOA:
    # A wallet is paid by external message; the internal path to a non
    # contract address is recorded and dropped (lacre value-probe-2). It
    # executes when the paying transaction finalizes.
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class TradeData:
    seller: Address
    buyer: Address
    price: u256
    fee_amount: u256
    listing_title: str
    listing_description: str
    listing_media_cid: str
    created_at: u64
    state: u8 = u8(OPEN)
    paid_at: u64 = u64(0)
    tracking_number: str = ""
    tracking_carrier: str = ""
    carrier_domains: str = ""
    packing_media_cid: str = ""
    shipped_at: u64 = u64(0)
    delivery_proof: str = ""
    proof_kind: str = ""
    proof_at: u64 = u64(0)
    delivered_at: u64 = u64(0)
    unboxing_media_cid: str = ""
    disputed_at: u64 = u64(0)
    claim_kind: u8 = u8(0)
    buyer_evidence: str = ""
    buyer_bond: u256 = u256(0)
    seller_evidence: str = ""
    seller_response_cid: str = ""
    seller_bond: u256 = u256(0)
    responded: bool = False
    was_disputed: bool = False
    buyer_wins: bool = False
    resolved_by_default: bool = False
    verdict_hash: str = ""


class Contract(gl.Contract):
    admin: Address
    pending_admin: Address
    paused: bool
    arbiter_address: Address
    router_address: Address
    pending_upgrade_code: bytes
    upgrade_unlock_at: u64
    next_trade_id: u256
    trades: TreeMap[u256, TradeData]
    first_seen: TreeMap[Address, u64]
    # domain|selector|bh|signed_at of an accepted proof to its trade: one
    # signed email serves one trade, however many records attest it.
    proof_messages: TreeMap[str, u256]
    fees_collected: u256
    eligible_trades: DynArray[u256]

    def __init__(self, router: str = ROUTER):
        self.admin = gl.message.sender_address
        self.router_address = Address(router)
        self._recipient(self.router_address)
        gl.storage.Root.get().upgraders.get().append(gl.message.sender_address)

    def _now(self) -> u64:
        return u64(int(datetime.now(timezone.utc).timestamp()))

    def _unpaused(self) -> None:
        if self.paused:
            _fail("paused")

    def _admin(self) -> None:
        if gl.message.sender_address != self.admin:
            _fail("not admin")

    def _recipient(self, addr: Address) -> None:
        if addr == ZERO or addr == gl.message.contract_address:
            _fail("bad address")

    def _get(self, trade_id: u256, role: str, *states: u8) -> TradeData:
        t = self.trades[trade_id]
        if role and gl.message.sender_address != (t.seller if role == "seller" else t.buyer):
            _fail("not " + role)
        if t.state not in states:
            _fail("wrong state")
        return t

    def _track(self, user: Address, now: u64) -> None:
        if user not in self.first_seen:
            self.first_seen[user] = now

    def _claim_at(self, t: TradeData) -> u64:
        # Seller's earliest claim and buyer's dispute deadline, one instant.
        end = t.shipped_at + DISPUTE_WINDOW
        if t.proof_at:
            end = min(end, t.proof_at + PROOF_CLAIM_DELAY)
        return end

    @gl.public.write
    def create_listing(self, title: str, description: str, price: u256,
                       listing_media_cid: str) -> u256:
        self._unpaused()
        if price < MIN_PRICE or price > MAX_PRICE:
            _fail("price")
        _len(title, 1, 200, "title")
        _len(description, 1, 2000, "description")
        _cid(listing_media_cid)
        trade_id = self.next_trade_id
        seller = gl.message.sender_address
        now = self._now()
        self.trades[trade_id] = TradeData(
            seller, seller, price, price * FEE_BPS // BPS, title, description,
            listing_media_cid, now)
        self.next_trade_id += 1
        self._track(seller, now)
        return trade_id

    @gl.public.write
    def cancel_listing(self, trade_id: u256) -> None:
        self._unpaused()
        self._get(trade_id, "seller", OPEN).state = CANCELLED

    @gl.public.write.payable
    def accept_listing(self, trade_id: u256) -> None:
        self._unpaused()
        t = self._get(trade_id, "", OPEN)
        buyer = gl.message.sender_address
        if gl.message.value != t.price:
            _fail("payment mismatch")
        if buyer == t.seller:
            _fail("own listing")
        now = self._now()
        t.buyer = buyer
        t.paid_at = now
        t.state = PAID
        self._track(buyer, now)

    @gl.public.write
    def mark_shipped(self, trade_id: u256, tracking_number: str, tracking_carrier: str,
                     carrier_domains: str, packing_media_cid: str) -> None:
        self._unpaused()
        t = self._get(trade_id, "seller", PAID)
        _len(tracking_number, 4, 100, "tracking")
        _len(tracking_carrier, 1, 50, "carrier")
        ds = carrier_domains.split(",") if carrier_domains else []
        if len(ds) > 3 or any(d not in CARRIER_DOMAINS for d in ds):
            _fail("carrier domain")
        _cid(packing_media_cid)
        t.tracking_number = tracking_number
        t.tracking_carrier = tracking_carrier
        t.carrier_domains = carrier_domains
        t.packing_media_cid = packing_media_cid
        t.shipped_at = self._now()
        t.state = SHIPPED

    @gl.public.write
    def confirm_delivery(self, trade_id: u256) -> None:
        t = self._get(trade_id, "buyer", SHIPPED)
        t.delivered_at = self._now()
        self._pay(trade_id, COMPLETED, 0, t.price - t.fee_amount, t.fee_amount)

    @gl.public.write
    def claim_after_window(self, trade_id: u256) -> None:
        t = self._get(trade_id, "seller", SHIPPED)
        now = self._now()
        if now < self._claim_at(t):
            _fail("dispute window open")
        t.delivered_at = now
        self._pay(trade_id, COMPLETED, 0, t.price - t.fee_amount, t.fee_amount)

    @gl.public.write
    def claim_unshipped_refund(self, trade_id: u256) -> None:
        t = self._get(trade_id, "buyer", PAID)
        if self._now() < t.paid_at + MAX_SHIPPING_DELAY:
            _fail("shipping window open")
        self._pay(trade_id, REFUNDED, t.price, 0, 0)

    @gl.public.write
    def set_unboxing_media(self, trade_id: u256, cid: str) -> None:
        # Once a dispute is decided its evidence is closed. On a trade that
        # was never disputed the CID only feeds reputation and moves no money.
        t = self._get(trade_id, "buyer", DISPUTED, COMPLETED)
        if t.state == COMPLETED and t.was_disputed:
            _fail("wrong state")
        start = t.disputed_at if t.was_disputed else t.delivered_at
        if self._now() >= start + UNBOXING_WINDOW:
            _fail("unboxing window closed")
        if t.unboxing_media_cid or not cid:
            _fail("cid")
        _cid(cid)
        t.unboxing_media_cid = cid

    @gl.public.write.payable
    def open_dispute(self, trade_id: u256, claim_kind: int, statement: str, cid: str) -> None:
        self._unpaused()
        t = self._get(trade_id, "buyer", SHIPPED)
        now = self._now()
        if now >= self._claim_at(t):
            _fail("dispute window closed")
        if gl.message.value != BUYER_BOND:
            _fail("bond")
        if claim_kind not in (NOT_RECEIVED, DAMAGED, NOT_AS_DESCRIBED):
            _fail("claim kind")
        _len(statement, 1, 2000, "statement")
        _cid(cid)
        t.claim_kind = claim_kind
        t.buyer_evidence = statement
        t.buyer_bond = BUYER_BOND
        t.unboxing_media_cid = cid
        t.disputed_at = now
        t.was_disputed = True
        t.state = DISPUTED

    @gl.public.write.payable
    def respond_to_dispute(self, trade_id: u256, statement: str, cid: str) -> None:
        t = self._get(trade_id, "seller", DISPUTED)
        if t.responded:
            _fail("already responded")
        if self._now() >= t.disputed_at + DISPUTE_RESPONSE_WINDOW:
            _fail("response window closed")
        if gl.message.value != t.price * SELLER_BOND_BPS // BPS:
            _fail("bond")
        _len(statement, 1, 2000, "statement")
        _cid(cid)
        t.seller_evidence = statement
        t.seller_response_cid = cid
        t.seller_bond = gl.message.value
        t.responded = True

    @gl.public.write
    def settle(self, trade_id: u256, buyer_wins: bool, reasoning_hash: str) -> None:
        # The only verdict path. Anything but a first message from the
        # Arbiter on an open dispute is refused, so a repeated or late emit
        # changes nothing.
        if self.arbiter_address == ZERO or gl.message.sender_address != self.arbiter_address:
            _fail("not arbiter")
        t = self._get(trade_id, "", DISPUTED)
        _len(reasoning_hash, 64, 64, "hash")
        t.verdict_hash = reasoning_hash
        t.buyer_wins = buyer_wins
        bonds = t.buyer_bond + t.seller_bond
        if buyer_wins:
            self._pay(trade_id, COMPLETED, t.price + bonds, 0, 0)
        else:
            self._pay(trade_id, COMPLETED, 0, t.price - t.fee_amount + bonds, t.fee_amount)

    @gl.public.write
    def claim_dispute_default(self, trade_id: u256) -> None:
        t = self._get(trade_id, "buyer", DISPUTED)
        if t.responded:
            _fail("responded")
        if self._now() < t.disputed_at + DISPUTE_RESPONSE_WINDOW:
            _fail("response window open")
        # Burden rules R1 to R3 hold under silence too: a claim they defeat
        # or hold back goes to the Arbiter, not to default judgment.
        if (t.proof_kind and t.claim_kind == NOT_RECEIVED) or (
                t.claim_kind != NOT_RECEIVED and not t.unboxing_media_cid):
            _fail("burden not met")
        t.resolved_by_default = True
        t.buyer_wins = True
        penalty = t.buyer_bond * PENALTY_BPS // BPS
        self._pay(trade_id, COMPLETED, t.price + t.buyer_bond - penalty, 0, penalty)

    @gl.public.write
    def force_refund_stuck_dispute(self, trade_id: u256) -> None:
        self._admin()
        self._stuck(trade_id, ADMIN_FORCE_REFUND_DELAY)

    @gl.public.write
    def claim_stuck_dispute_refund(self, trade_id: u256) -> None:
        self._stuck(trade_id, PUBLIC_FORCE_REFUND_DELAY)

    def _stuck(self, trade_id: u256, delay: u64) -> None:
        t = self._get(trade_id, "", DISPUTED)
        if self._now() < t.disputed_at + delay:
            _fail("delay pending")
        half = t.price // 2
        self._pay(trade_id, REFUNDED, half + t.buyer_bond, t.price - half + t.seller_bond,
                  0)

    def _pay(self, trade_id: u256, state: u8, to_buyer: u256, to_seller: u256,
             fee: u256) -> None:
        # Every payout leaves here: bookkeeping, then state, then the
        # transfers, so nothing is read after money is committed. A completed
        # trade that paid the buyer nothing is a sale, and only sales feed the
        # eligible list Reputation reads.
        t = self.trades[trade_id]
        if state == COMPLETED and not to_buyer:
            self.eligible_trades.append(trade_id)
        self.fees_collected += fee
        t.state = state
        if to_buyer:
            _EOA(t.buyer).emit_transfer(value=to_buyer)
        if to_seller:
            _EOA(t.seller).emit_transfer(value=to_seller)

    def _require_attestation(self, record_id: str, domains: str, paid_at: u64) -> str:
        record = {}
        for d in domains.split(",") if domains else []:
            verifier, record = attested(self.router_address, record_id, d, MIN_KEY_BITS)
            if verifier is not None:
                break
        try:
            signed_at = int(record.get("signed_at", 0))
        except Exception:
            signed_at = 0
        # Signed values only: other fields may come from unsigned headers.
        key = "|".join(str(record.get(f, "")) for f in ("domain", "selector", "bh", "signed_at"))
        # An email signed before the buyer paid cannot be about this shipment.
        if not record or signed_at <= paid_at or key in self.proof_messages:
            _fail("no accepted attestation")
        return key

    @gl.public.write
    def submit_delivery_proof(self, trade_id: u256, record_id: str) -> None:
        t = self._get(trade_id, "seller", SHIPPED, DISPUTED)
        if t.delivery_proof:
            _fail("proof set")
        rid = record_id.strip()
        key = self._require_attestation(rid, t.carrier_domains, t.paid_at)
        self.proof_messages[key] = trade_id
        t.delivery_proof = rid
        t.proof_kind = "dkim"
        t.proof_at = self._now()

    @gl.public.write
    def set_arbiter(self, arbiter: Address) -> None:
        # One-shot: replacing the judge means redeploying the Escrow.
        self._admin()
        if self.arbiter_address != ZERO:
            _fail("arbiter set")
        self._recipient(arbiter)
        self.arbiter_address = arbiter

    @gl.public.write
    def pause(self) -> None:
        self._admin()
        self.paused = True

    @gl.public.write
    def unpause(self) -> None:
        self._admin()
        self.paused = False

    @gl.public.write
    def withdraw_fees(self, recipient: Address, amount: u256) -> None:
        self._admin()
        if amount == 0 or amount > self.fees_collected:
            _fail("amount")
        self._recipient(recipient)
        self.fees_collected -= amount
        _EOA(recipient).emit_transfer(value=amount)

    @gl.public.write
    def transfer_admin(self, new_admin: Address) -> None:
        self._admin()
        if new_admin == ZERO or new_admin == self.admin:
            _fail("bad address")
        self.pending_admin = new_admin

    @gl.public.write
    def accept_admin(self) -> None:
        if self.pending_admin == ZERO or gl.message.sender_address != self.pending_admin:
            _fail("not pending admin")
        self.admin = self.pending_admin
        self.pending_admin = ZERO

    @gl.public.write
    def cancel_pending_admin(self) -> None:
        self._admin()
        if self.pending_admin == ZERO:
            _fail("no pending admin")
        self.pending_admin = ZERO

    @gl.public.write
    def propose_upgrade(self, new_code: bytes) -> None:
        self._admin()
        if len(new_code) == 0:
            _fail("empty code")
        self.pending_upgrade_code = new_code
        self.upgrade_unlock_at = self._now() + UPGRADE_TIMELOCK

    @gl.public.write
    def execute_upgrade(self) -> None:
        self._admin()
        if len(self.pending_upgrade_code) == 0:
            _fail("no pending upgrade")
        if self._now() < self.upgrade_unlock_at:
            _fail("timelock pending")
        code = gl.storage.Root.get().code.get()
        code.truncate()
        code.extend(self.pending_upgrade_code)
        self.cancel_pending_upgrade()

    @gl.public.write
    def cancel_pending_upgrade(self) -> None:
        self._admin()
        if len(self.pending_upgrade_code) == 0:
            _fail("no pending upgrade")
        self.pending_upgrade_code = b""
        self.upgrade_unlock_at = 0

    @gl.public.view
    def get_trade(self, trade_id: u256) -> dict:
        t = self.trades[trade_id]
        out = {}
        for f in fields(TradeData):
            v = getattr(t, f.name)
            out[f.name] = str(v) if f.type in (Address, u256) else v
        out["trade_id"] = str(trade_id)
        out["claim_at"] = self._claim_at(t) if t.shipped_at else 0
        out["buyer_first_seen"] = self.first_seen.get(t.buyer, 0)
        out["seller_first_seen"] = self.first_seen.get(t.seller, 0)
        return out

    @gl.public.view
    def get_eligible(self, start: int, count: int) -> dict:
        # Bounded like the v1.4.7 window views, which now live on Reputation.
        n = len(self.eligible_trades)
        start = max(start, 0)
        end = min(n, start + min(max(count, 0), 1000))
        return {"total": n, "ids": [int(self.eligible_trades[i]) for i in range(start, end)]}

    @gl.public.view
    def get_contract_info(self) -> dict:
        return {
            "version": int(VERSION),
            "admin": str(self.admin),
            "pending_admin": str(self.pending_admin),
            "paused": self.paused,
            "arbiter": str(self.arbiter_address),
            "router": str(self.router_address),
            "carrier_domains": list(CARRIER_DOMAINS),
            "upgrade_unlock_at": int(self.upgrade_unlock_at),
            "has_pending_upgrade": len(self.pending_upgrade_code) > 0,
            "total_trades": str(self.next_trade_id),
            "fees_collected": str(self.fees_collected),
        }
