//! Hugshire Vault
//!
//! Pools supporters' USDC and supplies it to RHEA Lending (`contract.main.burrow.near`).
//!
//! Safety properties enforced on chain:
//!  1. Principal is recorded per owner account. Only the owner can withdraw it, and it is paid
//!     only to the owner.
//!  2. The operator (a hot key used by the Hugshire worker) can only call `distribute_yield`, which
//!     pays an allowlisted recipient, and only while
//!         assets - pending_distribution - amount >= total_principal
//!     so it can never spend principal. Each distribution memo can be used only once.
//!  3. The owner (a multisig in production) manages the allowlist, the operator and pause. The owner
//!     cannot withdraw anyone's principal either.
//!  4. If the pool ever holds less than total principal (a protocol loss), withdrawals pay pro-rata
//!     and distributions stop.
//!
//! RHEA call formats were verified against ref-finance/burrowland on 2026-11-07:
//!  - supply:   usdc.ft_transfer_call(rhea, amount, msg = "")
//!  - withdraw: rhea.simple_withdraw(token_id, amount_with_inner_decimal, recipient_id) (1 yocto)
//!              which resolves to `true` on success and `false` on failure
//!  - balance:  rhea.get_account(account_id).supplied[token_id].balance (inner decimals = 6 + 12)
//!
//! NOT AUDITED. Do not deploy with real funds before an independent audit.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

const EXTRA_DECIMALS: u128 = 1_000_000_000_000; // RHEA USDC extra_decimals = 12
/// Cap on cross-contract results we read (RHEA get_account can be large).
const MAX_RESULT: usize = 65_536;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const GAS_VIEW: Gas = Gas::from_tgas(10);
const GAS_RHEA_WITHDRAW: Gas = Gas::from_tgas(120);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(100);
const GAS_CALLBACK: Gas = Gas::from_tgas(20);
const GAS_CALLBACK_WITH_WITHDRAW: Gas = Gas::from_tgas(160);

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Totals {
    pub total_principal: U128,
    pub total_distributed: U128,
    pub idle: U128,
    pub pending_distribution: U128,
    pub paused: bool,
    pub withdrawals_paused: bool,
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

#[derive(Deserialize, Default)]
#[serde(crate = "near_sdk::serde")]
struct DepositMsg {
    owner: Option<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner_id: AccountId,
    proposed_owner_id: Option<AccountId>,
    operator_id: AccountId,
    usdc: AccountId,
    rhea: AccountId,
    paused: bool,
    withdrawals_paused: bool,
    principal: LookupMap<AccountId, u128>,
    total_principal: u128,
    total_distributed: u128,
    /// USDC held by the Vault itself (received, not yet supplied to RHEA).
    idle: u128,
    /// Yield approved for distribution whose RHEA withdrawal is still in flight.
    pending_distribution: u128,
    recipients: LookupSet<AccountId>,
    used_memos: LookupSet<String>,
}

// ───────────────────────────── pure rules (unit tested) ─────────────────────────────

/// Amount paid for a principal withdrawal: full if the pool is whole, otherwise pro-rata.
pub fn redeemable(amount: u128, assets: u128, total_principal: u128, pending: u128) -> u128 {
    let available = assets.saturating_sub(pending);
    if total_principal == 0 || available >= total_principal {
        amount
    } else {
        // amount * available / total_principal without overflow for realistic values (u128)
        amount.checked_mul(available).expect("overflow") / total_principal
    }
}

/// A distribution is allowed only if it leaves at least total principal in the pool.
pub fn distribution_allowed(amount: u128, assets: u128, total_principal: u128, pending: u128) -> bool {
    match assets.checked_sub(pending).and_then(|a| a.checked_sub(amount)) {
        Some(left) => left >= total_principal,
        None => false,
    }
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner_id: AccountId, operator_id: AccountId, usdc: AccountId, rhea: AccountId) -> Self {
        Self {
            owner_id,
            proposed_owner_id: None,
            operator_id,
            usdc,
            rhea,
            paused: false,
            withdrawals_paused: false,
            principal: LookupMap::new(b"p"),
            total_principal: 0,
            total_distributed: 0,
            idle: 0,
            pending_distribution: 0,
            recipients: LookupSet::new(b"r"),
            used_memos: LookupSet::new(b"m"),
        }
    }

    // ───────────── deposits ─────────────

    /// NEP-141 receiver. Accepts only the configured USDC. `msg` may name a different owner
    /// (`{"owner":"alice.near"}`); otherwise the sender owns the principal.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Only USDC is accepted");
        require!(!self.paused, "Deposits are paused");
        require!(amount.0 > 0, "Zero amount");
        let parsed: DepositMsg = if msg.is_empty() {
            DepositMsg::default()
        } else {
            near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("Invalid msg"))
        };
        let owner = parsed.owner.unwrap_or(sender_id);
        let cur = self.principal.get(&owner).copied().unwrap_or(0);
        self.principal.insert(owner.clone(), cur + amount.0);
        self.total_principal += amount.0;
        self.idle += amount.0;
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"hugshire\",\"version\":\"1\",\"event\":\"deposit\",\"data\":{{\"owner\":\"{}\",\"amount\":\"{}\"}}}}",
            owner, amount.0
        ));
        PromiseOrValue::Value(U128(0))
    }

    /// Operator: supply idle USDC to RHEA.
    pub fn supply(&mut self, amount: U128) -> Promise {
        self.assert_operator();
        require!(amount.0 > 0 && amount.0 <= self.idle, "Amount exceeds idle balance");
        self.idle -= amount.0;
        Promise::new(self.usdc.clone())
            .function_call(
                "ft_transfer_call".to_string(),
                near_sdk::serde_json::json!({ "receiver_id": self.rhea, "amount": amount, "msg": "" }).to_string().into_bytes(),
                ONE_YOCTO,
                GAS_FT_TRANSFER_CALL,
            )
            .then(Self::ext_self().with_static_gas(GAS_CALLBACK).on_supplied(amount))
    }

    #[private]
    pub fn on_supplied(&mut self, amount: U128) -> U128 {
        // ft_transfer_call resolves to the amount actually used by the receiver.
        let used = match env::promise_result_checked(0, MAX_RESULT) {
            Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0).unwrap_or(0),
            _ => 0,
        };
        let refunded = amount.0.saturating_sub(used);
        self.idle += refunded;
        U128(used)
    }

    // ───────────── principal withdrawals (owner of the principal only) ─────────────

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        require!(!self.withdrawals_paused, "Withdrawals are paused");
        let who = env::predecessor_account_id();
        let cur = self.principal.get(&who).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= cur, "Amount exceeds your principal");
        // Debit first so concurrent calls can't withdraw twice; restored if anything fails.
        self.principal.insert(who.clone(), cur - amount.0);
        let tp_before = self.total_principal;
        self.total_principal -= amount.0;
        self.rhea_balance().then(
            Self::ext_self()
                .with_static_gas(GAS_CALLBACK_WITH_WITHDRAW)
                .on_assets_for_withdraw(who, amount, U128(tp_before)),
        )
    }

    #[private]
    pub fn on_assets_for_withdraw(&mut self, owner: AccountId, amount: U128, total_principal_before: U128) -> PromiseOrValue<U128> {
        let supplied = match Self::parse_supplied(&self.usdc) {
            Some(s) => s,
            None => {
                self.restore_principal(&owner, amount.0);
                return PromiseOrValue::Value(U128(0));
            }
        };
        let assets = supplied + self.idle;
        let pay = redeemable(amount.0, assets, total_principal_before.0, self.pending_distribution);
        if pay == 0 {
            self.restore_principal(&owner, amount.0);
            return PromiseOrValue::Value(U128(0));
        }
        if self.idle >= pay {
            self.idle -= pay;
            PromiseOrValue::Promise(
                Promise::new(self.usdc.clone())
                    .function_call(
                        "ft_transfer".to_string(),
                        near_sdk::serde_json::json!({ "receiver_id": owner, "amount": U128(pay), "memo": "hugshire withdraw" }).to_string().into_bytes(),
                        ONE_YOCTO,
                        GAS_FT_TRANSFER,
                    )
                    .then(Self::ext_self().with_static_gas(GAS_CALLBACK).on_withdraw_paid(owner, amount, U128(pay), true)),
            )
        } else {
            PromiseOrValue::Promise(
                self.rhea_withdraw_to(pay, &owner)
                    .then(Self::ext_self().with_static_gas(GAS_CALLBACK).on_withdraw_paid(owner, amount, U128(pay), false)),
            )
        }
    }

    /// Resolves to the amount paid to the owner (0 if nothing was paid; principal is then restored).
    #[private]
    pub fn on_withdraw_paid(&mut self, owner: AccountId, amount: U128, pay: U128, from_idle: bool) -> U128 {
        let ok = match env::promise_result_checked(0, MAX_RESULT) {
            Ok(v) => from_idle || near_sdk::serde_json::from_slice::<bool>(&v).unwrap_or(false),
            _ => false,
        };
        if ok {
            env::log_str(&format!(
                "EVENT_JSON:{{\"standard\":\"hugshire\",\"version\":\"1\",\"event\":\"withdraw\",\"data\":{{\"owner\":\"{}\",\"principal\":\"{}\",\"paid\":\"{}\"}}}}",
                owner, amount.0, pay.0
            ));
            U128(pay.0)
        } else {
            if from_idle {
                self.idle += pay.0;
            }
            self.restore_principal(&owner, amount.0);
            U128(0)
        }
    }

    // ───────────── yield distribution (operator, allowlisted recipients, yield only) ─────────────

    pub fn distribute_yield(&mut self, recipient: AccountId, amount: U128, memo: String) -> Promise {
        self.assert_operator();
        require!(!self.paused, "Distributions are paused");
        require!(amount.0 > 0, "Zero amount");
        require!(self.recipients.contains(&recipient), "Recipient is not allowlisted");
        require!(memo.len() <= 64 && !memo.is_empty(), "Bad memo");
        require!(!self.used_memos.contains(&memo), "Memo already used");
        self.used_memos.insert(memo.clone());
        self.rhea_balance().then(
            Self::ext_self()
                .with_static_gas(GAS_CALLBACK_WITH_WITHDRAW)
                .on_assets_for_distribution(recipient, amount, memo),
        )
    }

    #[private]
    pub fn on_assets_for_distribution(&mut self, recipient: AccountId, amount: U128, memo: String) -> PromiseOrValue<bool> {
        let Some(supplied) = Self::parse_supplied(&self.usdc) else {
            self.used_memos.remove(&memo);
            return PromiseOrValue::Value(false);
        };
        let assets = supplied + self.idle;
        if !distribution_allowed(amount.0, assets, self.total_principal, self.pending_distribution) {
            self.used_memos.remove(&memo);
            env::log_str("Distribution refused: it would touch principal");
            return PromiseOrValue::Value(false);
        }
        self.pending_distribution += amount.0;
        PromiseOrValue::Promise(
            self.rhea_withdraw_to(amount.0, &recipient)
                .then(Self::ext_self().with_static_gas(GAS_CALLBACK).on_distributed(recipient, amount, memo)),
        )
    }

    #[private]
    pub fn on_distributed(&mut self, recipient: AccountId, amount: U128, memo: String) -> bool {
        self.pending_distribution -= amount.0;
        let ok = matches!(env::promise_result_checked(0, MAX_RESULT), Ok(v) if near_sdk::serde_json::from_slice::<bool>(&v).unwrap_or(false));
        if ok {
            self.total_distributed += amount.0;
            env::log_str(&format!(
                "EVENT_JSON:{{\"standard\":\"hugshire\",\"version\":\"1\",\"event\":\"yield_distributed\",\"data\":{{\"recipient\":\"{}\",\"amount\":\"{}\",\"memo\":\"{}\"}}}}",
                recipient, amount.0, memo
            ));
        } else {
            self.used_memos.remove(&memo);
        }
        ok
    }

    // ───────────── owner administration ─────────────

    pub fn add_recipient(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.recipients.insert(account_id);
    }
    pub fn remove_recipient(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.recipients.remove(&account_id);
    }
    pub fn set_operator(&mut self, operator_id: AccountId) {
        self.assert_owner();
        self.operator_id = operator_id;
    }
    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner_or_operator_pausing(paused);
        self.paused = paused;
    }
    /// Emergency only (e.g. RHEA incident). Owner only.
    pub fn set_withdrawals_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.withdrawals_paused = paused;
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

    // ───────────── views ─────────────

    pub fn get_totals(&self) -> Totals {
        Totals {
            total_principal: U128(self.total_principal),
            total_distributed: U128(self.total_distributed),
            idle: U128(self.idle),
            pending_distribution: U128(self.pending_distribution),
            paused: self.paused,
            withdrawals_paused: self.withdrawals_paused,
        }
    }
    pub fn get_principal(&self, account_id: AccountId) -> U128 {
        U128(self.principal.get(&account_id).copied().unwrap_or(0))
    }
    pub fn is_recipient(&self, account_id: AccountId) -> bool {
        self.recipients.contains(&account_id)
    }
    pub fn get_roles(&self) -> (AccountId, AccountId) {
        (self.owner_id.clone(), self.operator_id.clone())
    }

    // ───────────── internals ─────────────

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
    }
    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator_id, "Operator only");
    }
    /// The operator may pause (fast incident response) but only the owner may unpause.
    fn assert_owner_or_operator_pausing(&self, pausing: bool) {
        let who = env::predecessor_account_id();
        require!(who == self.owner_id || (pausing && who == self.operator_id), "Not allowed");
    }
    fn restore_principal(&mut self, owner: &AccountId, amount: u128) {
        let cur = self.principal.get(owner).copied().unwrap_or(0);
        self.principal.insert(owner.clone(), cur + amount);
        self.total_principal += amount;
    }
    fn rhea_balance(&self) -> Promise {
        Promise::new(self.rhea.clone()).function_call(
            "get_account".to_string(),
            near_sdk::serde_json::json!({ "account_id": env::current_account_id() }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_VIEW,
        )
    }
    fn rhea_withdraw_to(&self, amount: u128, recipient: &AccountId) -> Promise {
        Promise::new(self.rhea.clone()).function_call(
            "simple_withdraw".to_string(),
            near_sdk::serde_json::json!({
                "token_id": self.usdc,
                "amount_with_inner_decimal": U128(amount * EXTRA_DECIMALS),
                "recipient_id": recipient,
            })
            .to_string()
            .into_bytes(),
            ONE_YOCTO,
            GAS_RHEA_WITHDRAW,
        )
    }
    /// Reads promise result 0 as RHEA's get_account and returns supplied USDC in micro units.
    fn parse_supplied(usdc: &AccountId) -> Option<u128> {
        match env::promise_result_checked(0, MAX_RESULT) {
            Ok(v) => {
                let acc: Option<RheaAccountView> = near_sdk::serde_json::from_slice(&v).ok()?;
                Some(
                    acc.and_then(|a| a.supplied.into_iter().find(|s| &s.token_id == usdc))
                        .map(|s| s.balance.0 / EXTRA_DECIMALS)
                        .unwrap_or(0),
                )
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn usdc() -> AccountId {
        "usdc.near".parse().unwrap()
    }
    fn ctx(pred: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id("vault.near".parse().unwrap()).predecessor_account_id(pred);
        b
    }
    fn vault() -> Vault {
        testing_env!(ctx(accounts(0)).build());
        Vault::new(accounts(0), accounts(1), usdc(), "contract.main.burrow.near".parse().unwrap())
    }

    #[test]
    fn rules_never_spend_principal() {
        assert!(distribution_allowed(10, 1_010, 1_000, 0));
        assert!(!distribution_allowed(11, 1_010, 1_000, 0));
        assert!(!distribution_allowed(10, 1_010, 1_000, 1));
        assert!(!distribution_allowed(10, 5, 1_000, 0));
        assert_eq!(redeemable(100, 1_100, 1_000, 0), 100);
        assert_eq!(redeemable(100, 900, 1_000, 0), 90); // pro-rata loss
        assert_eq!(redeemable(100, 1_000, 1_000, 100), 90);
    }

    #[test]
    fn deposits_credit_the_owner() {
        let mut v = vault();
        testing_env!(ctx(usdc()).build());
        let _ = v.ft_on_transfer(accounts(2), U128(500), "".into());
        let _ = v.ft_on_transfer(accounts(3), U128(250), r#"{"owner":"alice"}"#.into());
        assert_eq!(v.get_principal(accounts(2)).0, 500);
        assert_eq!(v.get_principal("alice".parse().unwrap()).0, 250);
        assert_eq!(v.get_totals().total_principal.0, 750);
        assert_eq!(v.get_totals().idle.0, 750);
    }

    #[test]
    #[should_panic(expected = "Only USDC is accepted")]
    fn rejects_other_tokens() {
        let mut v = vault();
        testing_env!(ctx("fake-usdc.near".parse().unwrap()).build());
        let _ = v.ft_on_transfer(accounts(2), U128(500), "".into());
    }

    #[test]
    #[should_panic(expected = "Amount exceeds your principal")]
    fn cannot_withdraw_someone_elses_principal() {
        let mut v = vault();
        testing_env!(ctx(usdc()).build());
        let _ = v.ft_on_transfer(accounts(2), U128(500), "".into());
        testing_env!(ctx(accounts(3)).build());
        let _ = v.withdraw(U128(1));
    }

    #[test]
    #[should_panic(expected = "Operator only")]
    fn owner_cannot_distribute() {
        let mut v = vault();
        testing_env!(ctx(accounts(0)).build());
        v.add_recipient(accounts(4));
        let _ = v.distribute_yield(accounts(4), U128(1), "m1".into());
    }

    #[test]
    #[should_panic(expected = "Recipient is not allowlisted")]
    fn operator_cannot_pay_unknown_accounts() {
        let mut v = vault();
        testing_env!(ctx(accounts(1)).build());
        let _ = v.distribute_yield(accounts(5), U128(1), "m1".into());
    }

    #[test]
    #[should_panic(expected = "Memo already used")]
    fn memo_is_single_use() {
        let mut v = vault();
        testing_env!(ctx(accounts(0)).build());
        v.add_recipient(accounts(4));
        testing_env!(ctx(accounts(1)).build());
        let _ = v.distribute_yield(accounts(4), U128(1), "payout-1".into());
        let _ = v.distribute_yield(accounts(4), U128(1), "payout-1".into());
    }

    #[test]
    #[should_panic(expected = "Not allowed")]
    fn operator_cannot_unpause() {
        let mut v = vault();
        testing_env!(ctx(accounts(1)).build());
        v.set_paused(true);
        v.set_paused(false);
    }

    #[test]
    fn withdraw_debits_immediately_to_block_double_spend() {
        let mut v = vault();
        testing_env!(ctx(usdc()).build());
        let _ = v.ft_on_transfer(accounts(2), U128(500), "".into());
        testing_env!(ctx(accounts(2)).build());
        let _ = v.withdraw(U128(300));
        assert_eq!(v.get_principal(accounts(2)).0, 200);
        assert_eq!(v.get_totals().total_principal.0, 200);
    }
}
