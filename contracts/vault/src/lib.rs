//! Hugshire Vault v2: programmable charitable-yield vault on NEAR.
//!
//! Supporters own *shares* of a pooled USDC position supplied to RHEA lending. Their principal is
//! withdrawable by them only; the yield their shares earn can only be donated to approved causes,
//! following destinations the supporter set on chain. See docs/VAULT_V2.md for the full design,
//! worked examples and invariants.
//!
//! Who can do what (enforced here, not in any backend):
//!  - supporter, full-access key (1 yocto attached): withdraw principal, set policy, donate anywhere approved
//!  - supporter, function-call session key (no deposit possible): donate only to their own policy
//!    causes, within their daily cap
//!  - keeper: process the deposit queue, supply idle USDC, and auto-deliver ONLY for supporters with an
//!    unexpired grant; amounts and destinations are computed here from the supporter's policy
//!  - owner (multisig): approve/retire causes, set keeper, pause (withdrawals at most 72 h at a time)
//!  - nobody can move a supporter's principal except that supporter.
//!
//! Every price-dependent operation holds a vault lock from its RHEA balance read until its final
//! callback, so prices are never computed from stale reads and failures restore exact state.
//!
//! NOT AUDITED. Do not accept public deposits before an independent security review.

pub mod math;

use math::{position, principal_reduction, shares_for_deposit, shares_to_burn, split_bps};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

// ───────────────────────────── constants ─────────────────────────────

/// RHEA USDC extra_decimals (verified on mainnet 2026-11-08: get_asset().config.extra_decimals == 12).
const EXTRA_DECIMALS: u128 = 1_000_000_000_000;
const MAX_RESULT: usize = 64 * 1024;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);

pub const MIN_DEPOSIT: u128 = 1_000_000; // 1 USDC
pub const MAX_ALLOCATIONS: usize = 5;
pub const MAX_BATCH_USERS: usize = 20;
pub const MAX_CAUSES_PER_PAYOUT: usize = 6;
pub const LOCK_STALE_SEC: u64 = 3_600;
pub const USER_LOCK_INTERVAL_SEC: u64 = 60;
pub const MAX_WITHDRAW_PAUSE_SEC: u64 = 72 * 3_600;
pub const WITHDRAW_PAUSE_COOLDOWN_SEC: u64 = 24 * 3_600;
pub const MIN_AUTO_INTERVAL_SEC: u64 = 600;
pub const MAX_GRANT_SEC: u64 = 365 * 24 * 3_600;

const GAS_VIEW: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(100);
const GAS_RHEA_WITHDRAW: Gas = Gas::from_tgas(100);
const GAS_FINAL_CB: Gas = Gas::from_tgas(40);
const GAS_AFTER_PAYOUT_WITHDRAW: Gas = Gas::from_tgas(115); // 6 transfers + final callback + own work
const GAS_PRICED_PAYOUT: Gas = Gas::from_tgas(250);
const GAS_PRICED_WITHDRAW: Gas = Gas::from_tgas(170);
const GAS_PRICED_PROCESS: Gas = Gas::from_tgas(165);
const GAS_SUPPLY_CB: Gas = Gas::from_tgas(20);
/// Operations that take the lock must be given enough gas to always reach their final callback.
const MIN_PREPAID_FOR_LOCKED_OP: Gas = Gas::from_tgas(290);

// ───────────────────────────── types ─────────────────────────────

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Allocation {
    pub cause: AccountId,
    pub bps: u16,
}

/// Permission for the keeper to deliver this supporter's eligible yield automatically.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AutoGrant {
    /// Do nothing until at least this much yield is eligible.
    pub min_amount: U128,
    /// Never deliver more than this in one automatic delivery.
    pub max_per_delivery: U128,
    /// At most one automatic delivery per this many seconds.
    pub min_interval_sec: u64,
    /// The grant stops working after this time (unix seconds).
    pub expires_at_sec: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Policy {
    /// Where this supporter's yield goes (sum of bps = 10_000). Session keys may only donate here.
    pub allocations: Vec<Allocation>,
    /// Most a session key may donate per UTC day (0 = session donations disabled).
    pub session_daily_cap: U128,
    pub auto: Option<AutoGrant>,
}

#[near(serializers = [borsh])]
#[derive(Default)]
pub struct Member {
    shares: u128,
    principal: u128,
    pending_deposit: u128,
    donated: u128,
    policy: Policy,
    last_auto_sec: u64,
    session_day: u64,
    session_spent: u128,
    last_lock_sec: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Cause {
    pub approved: bool,
    pub donated: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PayoutStatus {
    Pending,
    Completed,
    Partial,
    Failed,
    Stale,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payout {
    pub status: PayoutStatus,
    pub total: U128,
    pub delivered: U128,
    pub mode: String,
    pub created_sec: u64,
}

/// One authorised slice of a payout: `amount` of `user`'s yield to `cause`, paid by burning `shares`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Item {
    pub user: AccountId,
    pub cause: AccountId,
    pub amount: U128,
    pub shares: U128,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DonationRequest {
    pub cause: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LockInfo {
    pub op: String,
    pub since_sec: u64,
    pub payout: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Totals {
    pub total_shares: U128,
    pub total_principal: U128,
    pub idle: U128,
    pub pending_deposits: U128,
    pub total_donated: U128,
    pub last_rhea_supplied: U128,
    pub payout_seq: u64,
    pub locked: Option<LockInfo>,
    pub deposits_paused: bool,
    pub deposits_public: bool,
    pub donations_paused: bool,
    pub withdrawals_paused_until_sec: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MemberView {
    pub shares: U128,
    pub principal: U128,
    pub pending_deposit: U128,
    pub donated: U128,
    pub value: U128,
    pub yield_amount: U128,
    pub withdrawable: U128,
    pub policy: Policy,
    pub last_auto_sec: u64,
}

#[derive(Deserialize, Default)]
#[serde(crate = "near_sdk::serde")]
struct DepositMsg {
    owner: Option<AccountId>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RheaAssetView {
    token_id: AccountId,
    balance: U128,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RheaAccountView {
    supplied: Vec<RheaAssetView>,
}

// ───────────────────────────── contract ─────────────────────────────

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner_id: AccountId,
    proposed_owner_id: Option<AccountId>,
    keeper_id: AccountId,
    usdc: AccountId,
    rhea: AccountId,

    deposits_paused: bool,
    deposits_public: bool,
    donations_paused: bool,
    withdrawals_paused_until_sec: u64,
    last_withdraw_pause_end_sec: u64,

    depositors: LookupSet<AccountId>,
    members: LookupMap<AccountId, Member>,
    causes: LookupMap<AccountId, Cause>,
    user_cause_donated: LookupMap<(AccountId, AccountId), u128>,
    payouts: LookupMap<u64, Payout>,

    total_shares: u128,
    total_principal: u128,
    /// USDC held by the vault that belongs to shareholders (not pending deposits).
    idle: u128,
    /// USDC received for deposits not yet converted to shares.
    pending_deposits: u128,
    total_donated: u128,
    payout_seq: u64,
    lock: Option<LockInfo>,
    last_rhea_supplied: u128,
}

fn now_sec() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "hugshire", "version": "2.0.0", "event": event, "data": [data] })
    ));
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner_id: AccountId, keeper_id: AccountId, usdc: AccountId, rhea: AccountId) -> Self {
        Self {
            owner_id,
            proposed_owner_id: None,
            keeper_id,
            usdc,
            rhea,
            deposits_paused: false,
            deposits_public: false, // release control: closed until reviewed
            donations_paused: false,
            withdrawals_paused_until_sec: 0,
            last_withdraw_pause_end_sec: 0,
            depositors: LookupSet::new(b"d"),
            members: LookupMap::new(b"m"),
            causes: LookupMap::new(b"c"),
            user_cause_donated: LookupMap::new(b"u"),
            payouts: LookupMap::new(b"p"),
            total_shares: 0,
            total_principal: 0,
            idle: 0,
            pending_deposits: 0,
            total_donated: 0,
            payout_seq: 0,
            lock: None,
            last_rhea_supplied: 0,
        }
    }

    // ───────────── deposits (queued; shares minted at a fair price by process_deposits) ─────────────

    /// NEP-141 receiver. Only the configured USDC. Panicking refunds the sender in full.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC is accepted");
        require!(!self.deposits_paused, "Deposits are paused");
        require!(amount.0 >= MIN_DEPOSIT, "Minimum deposit is 1 USDC");
        let parsed: DepositMsg =
            if msg.is_empty() { DepositMsg::default() } else { serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg")) };
        let owner = parsed.owner.unwrap_or(sender_id.clone());
        require!(self.deposits_public || self.depositors.contains(&owner), "Deposits are not open yet");
        let mut m = self.take_member(&owner);
        m.pending_deposit += amount.0;
        self.pending_deposits += amount.0;
        self.members.insert(owner.clone(), m);
        emit("deposit_queued", json!({ "owner": owner, "from": sender_id, "amount": amount }));
        PromiseOrValue::Value(U128(0))
    }

    /// Supporter takes back a deposit that has not been converted to shares yet.
    #[payable]
    pub fn cancel_deposit(&mut self) -> Promise {
        self.assert_full_key();
        let who = env::predecessor_account_id();
        let mut m = self.take_member(&who);
        let amount = m.pending_deposit;
        require!(amount > 0, "No pending deposit");
        m.pending_deposit = 0;
        self.pending_deposits -= amount;
        self.members.insert(who.clone(), m);
        self.ft_transfer(&who, amount, "hugshire: deposit cancelled")
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_cancel_done(who, U128(amount)))
    }

    #[private]
    pub fn on_cancel_done(&mut self, owner: AccountId, amount: U128) {
        if env::promise_result_checked(0, MAX_RESULT).is_err() {
            let mut m = self.take_member(&owner);
            m.pending_deposit += amount.0;
            self.pending_deposits += amount.0;
            self.members.insert(owner, m);
        } else {
            emit("deposit_cancelled", json!({ "owner": owner, "amount": amount }));
        }
    }

    /// Keeper: convert queued deposits into shares at the current price, then supply idle USDC to RHEA.
    pub fn process_deposits(&mut self, accounts: Vec<AccountId>) -> Promise {
        self.assert_keeper();
        require!(accounts.len() <= MAX_BATCH_USERS, "Too many accounts");
        self.acquire("process");
        self.read_rhea().then(Self::ext(env::current_account_id()).with_static_gas(GAS_PRICED_PROCESS).on_priced_process(accounts))
    }

    #[private]
    pub fn on_priced_process(&mut self, accounts: Vec<AccountId>) -> PromiseOrValue<()> {
        let Some(mut a) = self.parse_rhea() else {
            self.release("rhea read failed");
            return PromiseOrValue::Value(());
        };
        a += self.idle;
        for acc in accounts {
            let mut m = self.take_member(&acc);
            let p = m.pending_deposit;
            if p == 0 {
                self.members.insert(acc, m);
                continue;
            }
            let shares = shares_for_deposit(p, a, self.total_shares);
            if shares == 0 {
                self.members.insert(acc, m);
                continue;
            }
            m.shares += shares;
            m.principal += p;
            m.pending_deposit = 0;
            self.total_shares += shares;
            self.total_principal += p;
            self.pending_deposits -= p;
            self.idle += p;
            a += p;
            self.members.insert(acc.clone(), m);
            emit("deposit_processed", json!({ "owner": acc, "amount": U128(p), "shares": U128(shares) }));
        }
        self.supply_idle_or_release()
    }

    /// Keeper: supply any idle shareholder USDC to RHEA (value-neutral).
    pub fn supply(&mut self) -> PromiseOrValue<()> {
        self.assert_keeper();
        require!(self.idle > 0, "Nothing to supply");
        self.acquire("supply");
        self.supply_idle_or_release()
    }

    #[private]
    pub fn on_supplied(&mut self, amount: U128) {
        // ft_transfer_call resolves to the amount the receiver kept.
        let used = match env::promise_result_checked(0, MAX_RESULT) {
            Ok(v) => serde_json::from_slice::<U128>(&v).map(|u| u.0).unwrap_or(0),
            Err(_) => 0,
        };
        self.idle += amount.0.saturating_sub(used);
        emit("supplied", json!({ "amount": U128(used), "refunded": U128(amount.0.saturating_sub(used)) }));
        self.release("supply done");
    }

    // ───────────── principal withdrawal (supporter only, paid to the supporter) ─────────────

    /// Withdraw principal. `amount: None` withdraws everything withdrawable now.
    #[payable]
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        self.assert_full_key();
        require!(now_sec() >= self.withdrawals_paused_until_sec, "Withdrawals are temporarily paused");
        let who = env::predecessor_account_id();
        self.touch_user_lock(&who);
        self.acquire("withdraw");
        self.read_rhea()
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_PRICED_WITHDRAW).on_priced_withdraw(who, amount))
    }

    #[private]
    pub fn on_priced_withdraw(&mut self, owner: AccountId, amount: Option<U128>) -> PromiseOrValue<U128> {
        let Some(rhea) = self.parse_rhea() else {
            self.release("rhea read failed");
            return PromiseOrValue::Value(U128(0));
        };
        let a = rhea + self.idle;
        let mut m = self.take_member(&owner);
        let pos = position(m.shares, m.principal, a, self.total_shares);
        let amt = amount.map(|x| x.0).unwrap_or(pos.withdrawable);
        if amt == 0 || amt > pos.withdrawable {
            self.members.insert(owner.clone(), m);
            emit("withdraw_refused", json!({ "owner": owner, "requested": U128(amt), "withdrawable": U128(pos.withdrawable) }));
            self.release("withdraw refused");
            return PromiseOrValue::Value(U128(0));
        }
        let burn = if amount.is_none() && pos.value <= m.principal {
            m.shares // full exit in a loss: everything goes
        } else {
            shares_to_burn(amt, a, self.total_shares).min(m.shares)
        };
        let pr = principal_reduction(amt, m.principal, pos.value);
        m.shares -= burn;
        m.principal -= pr;
        self.total_shares -= burn;
        self.total_principal -= pr;
        self.members.insert(owner.clone(), m);

        let from_idle = self.idle >= amt;
        let p = if from_idle {
            self.idle -= amt;
            self.ft_transfer(&owner, amt, "hugshire: principal withdrawal")
        } else {
            self.rhea_withdraw(amt, &owner)
        };
        PromiseOrValue::Promise(p.then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FINAL_CB)
                .on_withdrawn(owner, U128(amt), U128(burn), U128(pr), from_idle),
        ))
    }

    /// Resolves to the amount paid (0 if it failed, in which case shares and principal are restored).
    #[private]
    pub fn on_withdrawn(&mut self, owner: AccountId, amount: U128, burned: U128, principal: U128, from_idle: bool) -> U128 {
        let ok = match env::promise_result_checked(0, MAX_RESULT) {
            Ok(v) => from_idle || serde_json::from_slice::<bool>(&v).unwrap_or(false),
            Err(_) => false,
        };
        if ok {
            emit("withdraw", json!({ "owner": owner, "amount": amount, "shares": burned, "principal": principal }));
            self.release("withdraw done");
            amount
        } else {
            let mut m = self.take_member(&owner);
            m.shares += burned.0;
            m.principal += principal.0;
            self.total_shares += burned.0;
            self.total_principal += principal.0;
            if from_idle {
                self.idle += amount.0;
            }
            self.members.insert(owner.clone(), m);
            emit("withdraw_failed", json!({ "owner": owner, "amount": amount }));
            self.release("withdraw failed");
            U128(0)
        }
    }

    // ───────────── policy (supporter, full key) ─────────────

    #[payable]
    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_full_key();
        self.validate_policy(&policy);
        let who = env::predecessor_account_id();
        let mut m = self.take_member(&who);
        m.policy = policy.clone();
        self.members.insert(who.clone(), m);
        emit("policy_set", json!({ "owner": who, "policy": policy }));
    }

    /// Stop automatic delivery immediately (also blocks a keeper batch already in flight).
    #[payable]
    pub fn revoke_auto(&mut self) {
        self.assert_full_key();
        let who = env::predecessor_account_id();
        let mut m = self.take_member(&who);
        m.policy.auto = None;
        self.members.insert(who.clone(), m);
        emit("auto_revoked", json!({ "owner": who }));
    }

    // ───────────── donations ─────────────

    /// Donate eligible yield now. With 1 yocto attached (full key) any approved cause is allowed.
    /// With no deposit (a function-call session key, e.g. the game) only causes in the supporter's
    /// own policy are allowed, within the policy's daily session cap.
    #[payable]
    pub fn donate(&mut self, requests: Vec<DonationRequest>) -> Promise {
        let deposit = env::attached_deposit();
        let session = if deposit == ONE_YOCTO {
            false
        } else if deposit.is_zero() {
            true
        } else {
            env::panic_str("Attach exactly 1 yoctoNEAR (full key) or nothing (session key)")
        };
        require!(!self.donations_paused, "Donations are paused");
        require!(!requests.is_empty() && requests.len() <= MAX_ALLOCATIONS, "1 to 5 donation requests");
        let who = env::predecessor_account_id();
        let m = self.take_member_ref(&who);
        let mut total: u128 = 0;
        for r in &requests {
            require!(r.amount.0 > 0, "Zero amount");
            require!(self.is_approved(&r.cause), "Cause is not approved");
            if session {
                require!(m.policy.allocations.iter().any(|a| a.cause == r.cause), "Session keys may only donate to your own chosen causes");
            }
            total += r.amount.0;
        }
        if session {
            let spent = if m.session_day == now_sec() / 86_400 { m.session_spent } else { 0 };
            require!(spent + total <= m.policy.session_daily_cap.0, "Over today's session donation cap");
        }
        self.touch_user_lock(&who);
        self.acquire("donate");
        self.read_rhea().then(
            Self::ext(env::current_account_id()).with_static_gas(GAS_PRICED_PAYOUT).on_priced_donate(who, requests, session),
        )
    }

    #[private]
    pub fn on_priced_donate(&mut self, owner: AccountId, requests: Vec<DonationRequest>, session: bool) -> PromiseOrValue<()> {
        let Some(rhea) = self.parse_rhea() else {
            self.release("rhea read failed");
            return PromiseOrValue::Value(());
        };
        let a = rhea + self.idle;
        let mut m = self.take_member(&owner);
        let pos = position(m.shares, m.principal, a, self.total_shares);
        let total: u128 = requests.iter().map(|r| r.amount.0).sum();
        // re-check everything at execution time: causes may have been retired, policy changed
        let still_ok = requests.iter().all(|r| self.is_approved(&r.cause))
            && (!session || requests.iter().all(|r| m.policy.allocations.iter().any(|al| al.cause == r.cause)));
        if !still_ok || total == 0 || total > pos.yield_amount {
            self.members.insert(owner.clone(), m);
            emit("donation_refused", json!({ "owner": owner, "requested": U128(total), "yield": U128(pos.yield_amount) }));
            self.release("donation refused");
            return PromiseOrValue::Value(());
        }
        let mut items = Vec::new();
        let mut burn_total: u128 = 0;
        for r in &requests {
            let s = shares_to_burn(r.amount.0, a, self.total_shares);
            burn_total += s;
            items.push(Item { user: owner.clone(), cause: r.cause.clone(), amount: r.amount, shares: U128(s) });
        }
        if burn_total > m.shares {
            self.members.insert(owner.clone(), m);
            self.release("donation refused: rounding");
            return PromiseOrValue::Value(());
        }
        m.shares -= burn_total;
        self.total_shares -= burn_total;
        if session {
            let day = now_sec() / 86_400;
            if m.session_day != day {
                m.session_day = day;
                m.session_spent = 0;
            }
            m.session_spent += total;
        }
        self.members.insert(owner, m);
        self.execute_payout(items, if session { "session" } else { "manual" })
    }

    /// Keeper: deliver eligible yield for supporters who granted automatic delivery.
    /// The keeper picks *when* (e.g. after the app saw an hour of inactivity); the contract decides
    /// how much (eligible yield within the grant's limits) and where (the supporter's own policy).
    pub fn auto_deliver(&mut self, accounts: Vec<AccountId>) -> Promise {
        self.assert_keeper();
        require!(!self.donations_paused, "Donations are paused");
        require!(!accounts.is_empty() && accounts.len() <= MAX_BATCH_USERS, "1 to 20 accounts");
        self.acquire("auto");
        self.read_rhea().then(Self::ext(env::current_account_id()).with_static_gas(GAS_PRICED_PAYOUT).on_priced_auto(accounts))
    }

    #[private]
    pub fn on_priced_auto(&mut self, accounts: Vec<AccountId>) -> PromiseOrValue<()> {
        let Some(rhea) = self.parse_rhea() else {
            self.release("rhea read failed");
            return PromiseOrValue::Value(());
        };
        let mut a = rhea + self.idle;
        let now = now_sec();
        let mut items: Vec<Item> = Vec::new();
        let mut causes: Vec<AccountId> = Vec::new();
        for acc in accounts {
            let mut m = self.take_member(&acc);
            let Some(grant) = m.policy.auto.clone() else {
                self.members.insert(acc, m);
                continue;
            };
            if now >= grant.expires_at_sec || now < m.last_auto_sec + grant.min_interval_sec {
                self.members.insert(acc, m);
                continue;
            }
            let pos = position(m.shares, m.principal, a, self.total_shares);
            let eligible = pos.yield_amount.min(grant.max_per_delivery.0);
            if eligible == 0 || eligible < grant.min_amount.0 {
                self.members.insert(acc, m);
                continue;
            }
            let bps: Vec<u16> = m.policy.allocations.iter().map(|al| al.bps).collect();
            let parts = split_bps(eligible, &bps);
            let mut mine: Vec<Item> = Vec::new();
            let mut burn: u128 = 0;
            let mut out: u128 = 0;
            for (al, part) in m.policy.allocations.iter().zip(parts) {
                if part == 0 || !self.is_approved(&al.cause) {
                    continue; // retired cause: its share simply stays with the supporter
                }
                let s = shares_to_burn(part, a - out, self.total_shares - burn);
                burn += s;
                out += part;
                mine.push(Item { user: acc.clone(), cause: al.cause.clone(), amount: U128(part), shares: U128(s) });
            }
            let mut new_causes = causes.clone();
            for it in &mine {
                if !new_causes.contains(&it.cause) {
                    new_causes.push(it.cause.clone());
                }
            }
            if mine.is_empty() || burn > m.shares || new_causes.len() > MAX_CAUSES_PER_PAYOUT {
                self.members.insert(acc, m);
                continue;
            }
            causes = new_causes;
            m.shares -= burn;
            m.last_auto_sec = now;
            self.total_shares -= burn;
            a -= out;
            self.members.insert(acc, m);
            items.extend(mine);
        }
        if items.is_empty() {
            self.release("auto: nothing eligible");
            return PromiseOrValue::Value(());
        }
        self.execute_payout(items, "auto")
    }

    // ───────────── payout pipeline ─────────────

    #[private]
    pub fn on_payout_withdrawn(&mut self, payout_id: u64, items: Vec<Item>, from_idle: U128) -> PromiseOrValue<()> {
        let ok = matches!(env::promise_result_checked(0, MAX_RESULT), Ok(v) if serde_json::from_slice::<bool>(&v).unwrap_or(false));
        if !ok {
            // RHEA re-credited our position; put the idle part back and restore every share burned.
            self.idle += from_idle.0;
            for it in &items {
                self.restore_item(it);
            }
            self.finish_payout(payout_id, PayoutStatus::Failed, 0);
            self.release("payout failed: rhea withdraw");
            return PromiseOrValue::Value(());
        }
        PromiseOrValue::Promise(self.transfer_phase(payout_id, items))
    }

    #[private]
    pub fn on_payout_transfers(&mut self, payout_id: u64, items: Vec<Item>, causes: Vec<AccountId>) {
        let mut delivered: u128 = 0;
        let mut failed_causes = 0;
        for (i, cause) in causes.iter().enumerate() {
            let ok = env::promise_result_checked(i as u64, MAX_RESULT).is_ok();
            let cause_items: Vec<&Item> = items.iter().filter(|it| &it.cause == cause).collect();
            let cause_total: u128 = cause_items.iter().map(|it| it.amount.0).sum();
            if ok {
                for it in cause_items {
                    self.credit_donation(payout_id, it);
                }
                delivered += cause_total;
            } else {
                failed_causes += 1;
                self.idle += cause_total; // the tokens never left the vault
                for it in cause_items {
                    self.restore_item(it);
                }
            }
        }
        let status = if failed_causes == 0 {
            PayoutStatus::Completed
        } else if delivered == 0 {
            PayoutStatus::Failed
        } else {
            PayoutStatus::Partial
        };
        self.finish_payout(payout_id, status, delivered);
        self.release("payout done");
    }

    // ───────────── owner / keeper administration ─────────────

    pub fn approve_cause(&mut self, account_id: AccountId) {
        self.assert_owner();
        let mut c = self.causes.get(&account_id).cloned().unwrap_or(Cause { approved: false, donated: U128(0) });
        c.approved = true;
        self.causes.insert(account_id.clone(), c);
        emit("cause_approved", json!({ "cause": account_id }));
    }
    pub fn retire_cause(&mut self, account_id: AccountId) {
        self.assert_owner();
        if let Some(c) = self.causes.get(&account_id).cloned() {
            self.causes.insert(account_id.clone(), Cause { approved: false, ..c });
        }
        emit("cause_retired", json!({ "cause": account_id }));
    }
    pub fn set_keeper(&mut self, keeper_id: AccountId) {
        self.assert_owner();
        self.keeper_id = keeper_id.clone();
        emit("keeper_set", json!({ "keeper": keeper_id }));
    }
    pub fn set_deposits_public(&mut self, public: bool) {
        self.assert_owner();
        self.deposits_public = public;
        emit("deposits_public", json!({ "public": public }));
    }
    pub fn add_depositor(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.depositors.insert(account_id);
    }
    pub fn remove_depositor(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.depositors.remove(&account_id);
    }
    /// Owner or keeper may pause; only the owner may unpause.
    pub fn set_deposits_paused(&mut self, paused: bool) {
        self.assert_pause_rights(paused);
        self.deposits_paused = paused;
        emit("deposits_paused", json!({ "paused": paused }));
    }
    pub fn set_donations_paused(&mut self, paused: bool) {
        self.assert_pause_rights(paused);
        self.donations_paused = paused;
        emit("donations_paused", json!({ "paused": paused }));
    }
    /// Emergency withdrawal pause: at most 72 hours, then a 24-hour cooldown before another.
    pub fn pause_withdrawals(&mut self, duration_sec: u64) {
        self.assert_owner();
        let now = now_sec();
        require!(duration_sec > 0 && duration_sec <= MAX_WITHDRAW_PAUSE_SEC, "At most 72 hours");
        require!(now >= self.withdrawals_paused_until_sec, "Already paused");
        require!(
            self.last_withdraw_pause_end_sec == 0 || now >= self.last_withdraw_pause_end_sec + WITHDRAW_PAUSE_COOLDOWN_SEC,
            "Cooldown: withdrawals must stay open 24 hours between pauses"
        );
        self.withdrawals_paused_until_sec = now + duration_sec;
        self.last_withdraw_pause_end_sec = now + duration_sec;
        emit("withdrawals_paused", json!({ "until_sec": self.withdrawals_paused_until_sec }));
    }
    pub fn unpause_withdrawals(&mut self) {
        self.assert_owner();
        self.withdrawals_paused_until_sec = 0;
        self.last_withdraw_pause_end_sec = now_sec();
        emit("withdrawals_unpaused", json!({}));
    }
    pub fn propose_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.proposed_owner_id = Some(owner_id);
    }
    pub fn accept_owner(&mut self) {
        let who = env::predecessor_account_id();
        require!(self.proposed_owner_id.as_ref() == Some(&who), "Not the proposed owner");
        self.owner_id = who;
        self.proposed_owner_id = None;
    }
    /// Anyone may clear a lock whose operation never finished (a callback ran out of gas).
    /// The payout it belonged to is marked Stale for review.
    pub fn unlock_stale(&mut self) {
        let Some(l) = self.lock.clone() else { env::panic_str("Not locked") };
        require!(now_sec() >= l.since_sec + LOCK_STALE_SEC, "Lock is not stale");
        if let Some(id) = l.payout {
            if let Some(p) = self.payouts.get(&id).cloned() {
                if p.status == PayoutStatus::Pending {
                    self.payouts.insert(id, Payout { status: PayoutStatus::Stale, ..p });
                }
            }
        }
        self.lock = None;
        emit("lock_stale_cleared", json!({ "op": l.op, "since_sec": l.since_sec, "payout": l.payout }));
    }

    // ───────────── views ─────────────

    pub fn get_totals(&self) -> Totals {
        Totals {
            total_shares: U128(self.total_shares),
            total_principal: U128(self.total_principal),
            idle: U128(self.idle),
            pending_deposits: U128(self.pending_deposits),
            total_donated: U128(self.total_donated),
            last_rhea_supplied: U128(self.last_rhea_supplied),
            payout_seq: self.payout_seq,
            locked: self.lock.clone(),
            deposits_paused: self.deposits_paused,
            deposits_public: self.deposits_public,
            donations_paused: self.donations_paused,
            withdrawals_paused_until_sec: self.withdrawals_paused_until_sec,
        }
    }

    /// Position of a supporter. Pass RHEA's current supplied balance (micro-USDC) for an exact value;
    /// otherwise the last balance the vault itself observed is used.
    pub fn get_member(&self, account_id: AccountId, rhea_supplied: Option<U128>) -> Option<MemberView> {
        let m = self.members.get(&account_id)?;
        let a = rhea_supplied.map(|x| x.0).unwrap_or(self.last_rhea_supplied) + self.idle;
        let pos = position(m.shares, m.principal, a, self.total_shares);
        Some(MemberView {
            shares: U128(m.shares),
            principal: U128(m.principal),
            pending_deposit: U128(m.pending_deposit),
            donated: U128(m.donated),
            value: U128(pos.value),
            yield_amount: U128(pos.yield_amount),
            withdrawable: U128(pos.withdrawable),
            policy: m.policy.clone(),
            last_auto_sec: m.last_auto_sec,
        })
    }
    pub fn get_cause(&self, account_id: AccountId) -> Option<Cause> {
        self.causes.get(&account_id).cloned()
    }
    pub fn get_donated(&self, user: AccountId, cause: AccountId) -> U128 {
        U128(self.user_cause_donated.get(&(user, cause)).copied().unwrap_or(0))
    }
    pub fn get_payout(&self, id: u64) -> Option<Payout> {
        self.payouts.get(&id).cloned()
    }
    pub fn get_roles(&self) -> (AccountId, AccountId) {
        (self.owner_id.clone(), self.keeper_id.clone())
    }
}

// ───────────────────────────── internals ─────────────────────────────

impl Vault {
    fn take_member(&mut self, who: &AccountId) -> Member {
        self.members.remove(who).unwrap_or_default()
    }
    fn take_member_ref(&self, who: &AccountId) -> &Member {
        self.members.get(who).unwrap_or_else(|| env::panic_str("No position"))
    }
    fn is_approved(&self, cause: &AccountId) -> bool {
        self.causes.get(cause).map(|c| c.approved).unwrap_or(false)
    }
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
    }
    fn assert_keeper(&self) {
        require!(env::predecessor_account_id() == self.keeper_id, "Keeper only");
    }
    fn assert_pause_rights(&self, pausing: bool) {
        let who = env::predecessor_account_id();
        require!(who == self.owner_id || (pausing && who == self.keeper_id), "Not allowed");
    }
    /// Function-call access keys cannot attach a deposit, so 1 yocto proves the user's full key signed.
    fn assert_full_key(&self) {
        require!(env::attached_deposit() == ONE_YOCTO, "Requires your full-access key (attach exactly 1 yoctoNEAR)");
    }
    fn touch_user_lock(&mut self, who: &AccountId) {
        let mut m = self.take_member(who);
        require!(m.shares > 0 || m.principal > 0, "No position");
        let now = now_sec();
        require!(m.last_lock_sec == 0 || now >= m.last_lock_sec + USER_LOCK_INTERVAL_SEC, "One vault operation per minute");
        m.last_lock_sec = now;
        self.members.insert(who.clone(), m);
    }
    fn acquire(&mut self, op: &str) {
        require!(self.lock.is_none(), "Vault busy, retry shortly");
        require!(env::prepaid_gas() >= MIN_PREPAID_FOR_LOCKED_OP, "Attach at least 290 TGas");
        self.lock = Some(LockInfo { op: op.to_string(), since_sec: now_sec(), payout: None });
    }
    fn release(&mut self, why: &str) {
        self.lock = None;
        env::log_str(&format!("unlock: {}", why));
    }
    fn validate_policy(&self, p: &Policy) {
        require!(p.allocations.len() <= MAX_ALLOCATIONS, "At most 5 causes");
        if !p.allocations.is_empty() {
            let sum: u32 = p.allocations.iter().map(|a| a.bps as u32).sum();
            require!(sum == 10_000, "Allocations must add up to 100%");
            for (i, a) in p.allocations.iter().enumerate() {
                require!(a.bps > 0, "Each allocation must be above 0");
                require!(self.is_approved(&a.cause), "Cause is not approved");
                require!(!p.allocations[..i].iter().any(|b| b.cause == a.cause), "Duplicate cause");
            }
        }
        if let Some(g) = &p.auto {
            require!(!p.allocations.is_empty(), "Automatic delivery needs at least one cause");
            require!(g.min_interval_sec >= MIN_AUTO_INTERVAL_SEC, "Interval must be at least 10 minutes");
            require!(g.max_per_delivery.0 >= g.min_amount.0 && g.max_per_delivery.0 > 0, "Invalid amounts");
            require!(g.expires_at_sec > now_sec() && g.expires_at_sec <= now_sec() + MAX_GRANT_SEC, "Grant must expire within a year");
        }
    }
    fn read_rhea(&self) -> Promise {
        Promise::new(self.rhea.clone()).function_call(
            "get_account".to_string(),
            json!({ "account_id": env::current_account_id() }).to_string().into_bytes(),
            NO_DEPOSIT,
            GAS_VIEW,
        )
    }
    /// RHEA supplied USDC for the vault, in micro-USDC (inner 18-decimal balance / 1e12).
    fn parse_rhea(&mut self) -> Option<u128> {
        let v = env::promise_result_checked(0, MAX_RESULT).ok()?;
        let acc: Option<RheaAccountView> = serde_json::from_slice(&v).ok()?;
        let s = acc.and_then(|a| a.supplied.into_iter().find(|s| s.token_id == self.usdc)).map(|s| s.balance.0 / EXTRA_DECIMALS).unwrap_or(0);
        self.last_rhea_supplied = s;
        Some(s)
    }
    fn ft_transfer(&self, to: &AccountId, amount: u128, memo: &str) -> Promise {
        Promise::new(self.usdc.clone()).function_call(
            "ft_transfer".to_string(),
            json!({ "receiver_id": to, "amount": U128(amount), "memo": memo }).to_string().into_bytes(),
            ONE_YOCTO,
            GAS_FT_TRANSFER,
        )
    }
    fn rhea_withdraw(&self, amount: u128, recipient: &AccountId) -> Promise {
        Promise::new(self.rhea.clone()).function_call(
            "simple_withdraw".to_string(),
            json!({ "token_id": self.usdc, "amount_with_inner_decimal": U128(amount * EXTRA_DECIMALS), "recipient_id": recipient })
                .to_string()
                .into_bytes(),
            ONE_YOCTO,
            GAS_RHEA_WITHDRAW,
        )
    }
    fn supply_idle_or_release(&mut self) -> PromiseOrValue<()> {
        if self.idle == 0 {
            self.release("nothing to supply");
            return PromiseOrValue::Value(());
        }
        let amount = self.idle;
        self.idle = 0;
        PromiseOrValue::Promise(
            Promise::new(self.usdc.clone())
                .function_call(
                    "ft_transfer_call".to_string(),
                    json!({ "receiver_id": self.rhea, "amount": U128(amount), "msg": "" }).to_string().into_bytes(),
                    ONE_YOCTO,
                    GAS_FT_TRANSFER_CALL,
                )
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_SUPPLY_CB).on_supplied(U128(amount))),
        )
    }
    /// Shares are already burned for every item. Pay from idle if possible, otherwise withdraw from RHEA first.
    fn execute_payout(&mut self, items: Vec<Item>, mode: &str) -> PromiseOrValue<()> {
        let total: u128 = items.iter().map(|i| i.amount.0).sum();
        self.payout_seq += 1;
        let id = self.payout_seq;
        self.payouts.insert(id, Payout { status: PayoutStatus::Pending, total: U128(total), delivered: U128(0), mode: mode.to_string(), created_sec: now_sec() });
        if let Some(l) = self.lock.as_mut() {
            l.payout = Some(id);
        }
        emit("payout_started", json!({ "payout_id": id, "mode": mode, "total": U128(total), "items": items }));
        if self.idle >= total {
            self.idle -= total;
            return PromiseOrValue::Promise(self.transfer_phase(id, items));
        }
        let from_idle = self.idle;
        let need = total - from_idle;
        self.idle = 0;
        PromiseOrValue::Promise(self.rhea_withdraw(need, &env::current_account_id()).then(
            Self::ext(env::current_account_id()).with_static_gas(GAS_AFTER_PAYOUT_WITHDRAW).on_payout_withdrawn(id, items, U128(from_idle)),
        ))
    }
    fn transfer_phase(&self, id: u64, items: Vec<Item>) -> Promise {
        let mut causes: Vec<AccountId> = Vec::new();
        for it in &items {
            if !causes.contains(&it.cause) {
                causes.push(it.cause.clone());
            }
        }
        let mut joined: Option<Promise> = None;
        for c in &causes {
            let amt: u128 = items.iter().filter(|it| &it.cause == c).map(|it| it.amount.0).sum();
            let p = self.ft_transfer(c, amt, &format!("hugshire payout {}", id));
            joined = Some(match joined {
                None => p,
                Some(j) => j.and(p),
            });
        }
        joined
            .expect("payout without causes")
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FINAL_CB).on_payout_transfers(id, items, causes))
    }
    fn restore_item(&mut self, it: &Item) {
        let mut m = self.take_member(&it.user);
        m.shares += it.shares.0;
        self.total_shares += it.shares.0;
        self.members.insert(it.user.clone(), m);
    }
    fn credit_donation(&mut self, payout_id: u64, it: &Item) {
        let mut m = self.take_member(&it.user);
        m.donated += it.amount.0;
        self.members.insert(it.user.clone(), m);
        let key = (it.user.clone(), it.cause.clone());
        let prev = self.user_cause_donated.get(&key).copied().unwrap_or(0);
        self.user_cause_donated.insert(key, prev + it.amount.0);
        let mut c = self.causes.get(&it.cause).cloned().unwrap_or(Cause { approved: false, donated: U128(0) });
        c.donated = U128(c.donated.0 + it.amount.0);
        self.causes.insert(it.cause.clone(), c);
        self.total_donated += it.amount.0;
        emit("donation", json!({ "payout_id": payout_id, "user": it.user, "cause": it.cause, "amount": it.amount, "shares": it.shares }));
    }
    fn finish_payout(&mut self, id: u64, status: PayoutStatus, delivered: u128) {
        if let Some(p) = self.payouts.get(&id).cloned() {
            if p.status == PayoutStatus::Pending {
                self.payouts.insert(id, Payout { status, delivered: U128(delivered), ..p });
            }
        }
        emit("payout_finished", json!({ "payout_id": id, "status": status, "delivered": U128(delivered) }));
    }
}

#[cfg(test)]
mod tests;
