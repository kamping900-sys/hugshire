//! TEST ONLY: a behavioural stand-in for RHEA lending (contract.main.burrow.near), reproducing the
//! parts of RHEA v0.15.7 source the Hugshire Vault relies on (docs/VAULT_V2.md §2):
//!  - storage registration required (min 0.1 NEAR); an unregistered sender's deposit panics → refund
//!  - supply via usdc.ft_transfer_call(rhea, amount, msg = "") credits the SENDER's supplied shares
//!  - pooled shares; balances in inner units = token units × 10^extra_decimals (12 for USDC)
//!  - get_account accrues to "now" (here: interest is applied explicitly by the test via `accrue`)
//!  - simple_withdraw(token_id, amount_with_inner_decimal, recipient_id), 1 yocto: debits shares
//!    (rounded up, in RHEA's favour), ft_transfers to the recipient, and after_ft_transfer
//!    RE-CREDITS the position if the transfer fails; resolves to true/false
//! Mainnet runs v0.16.2 whose source is not public: verify on mainnet before trusting this mock.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{env, is_promise_success, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};

const EXTRA: u128 = 1_000_000_000_000;

/// (a*b)/d with a 256-bit intermediate (RHEA uses U256 for share maths too).
fn mul_div(a: u128, b: u128, d: u128, up: bool) -> u128 {
    let (a1, a0) = (a >> 64, a & u64::MAX as u128);
    let (b1, b0) = (b >> 64, b & u64::MAX as u128);
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    let mid = (p00 >> 64) + (p01 & u64::MAX as u128) + (p10 & u64::MAX as u128);
    let lo = (p00 & u64::MAX as u128) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    assert!(hi < d, "overflow");
    let (mut rem, mut q) = (hi, 0u128);
    if hi == 0 {
        q = lo / d;
        rem = lo % d;
    } else {
        for i in (0..128).rev() {
            let carry = rem >> 127;
            rem = (rem << 1) | ((lo >> i) & 1);
            if carry == 1 || rem >= d {
                rem = rem.wrapping_sub(d);
                q |= 1 << i;
            }
        }
    }
    if up && rem > 0 { q + 1 } else { q }
}
const MIN_STORAGE: NearToken = NearToken::from_millinear(100);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockRhea {
    admin: AccountId,
    usdc: AccountId,
    pool_shares: u128,
    pool_balance: u128, // inner units
    accounts: LookupMap<AccountId, u128>, // supplied shares; presence = registered
    withdrawals_enabled: bool,
}

#[near]
impl MockRhea {
    #[init]
    pub fn new(admin: AccountId, usdc: AccountId) -> Self {
        Self { admin, usdc, pool_shares: 0, pool_balance: 0, accounts: LookupMap::new(b"a"), withdrawals_enabled: true }
    }

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> serde_json::Value {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        require!(env::attached_deposit() >= MIN_STORAGE, "Not enough storage deposit (min 0.1 NEAR)");
        if !self.accounts.contains_key(&who) {
            self.accounts.insert(who, 0);
        }
        json!({ "total": U128(MIN_STORAGE.as_yoctonear()), "available": "0" })
    }
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<serde_json::Value> {
        self.accounts.contains_key(&account_id).then(|| json!({ "total": U128(MIN_STORAGE.as_yoctonear()), "available": "0" }))
    }

    /// Supply. Only an empty msg (plain supply, no collateral) is supported here, like the vault uses.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "Asset not found");
        require!(msg.is_empty(), "mock supports plain supply only");
        let shares = self.accounts.get(&sender_id).copied().unwrap_or_else(|| env::panic_str("Account is not registered"));
        let inner = amount.0 * EXTRA;
        let minted = if self.pool_shares == 0 { inner } else { mul_div(inner, self.pool_shares, self.pool_balance, false) };
        self.accounts.insert(sender_id, shares + minted);
        self.pool_shares += minted;
        self.pool_balance += inner;
        PromiseOrValue::Value(U128(0))
    }

    pub fn get_account(&self, account_id: AccountId) -> Option<serde_json::Value> {
        let shares = *self.accounts.get(&account_id)?;
        let balance = if self.pool_shares == 0 { 0 } else { mul_div(shares, self.pool_balance, self.pool_shares, false) };
        let supplied = if shares == 0 { json!([]) } else { json!([{ "token_id": self.usdc, "balance": U128(balance), "shares": U128(shares) }]) };
        Some(json!({ "account_id": account_id, "supplied": supplied, "collateral": [], "borrowed": [] }))
    }

    #[payable]
    pub fn simple_withdraw(&mut self, token_id: AccountId, amount_with_inner_decimal: U128, recipient_id: Option<AccountId>) -> Promise {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Requires attached deposit of exactly 1 yoctoNEAR");
        require!(token_id == self.usdc, "Asset not found");
        require!(self.withdrawals_enabled, "Withdrawals for this asset are not enabled");
        let who = env::predecessor_account_id();
        let recipient = recipient_id.unwrap_or(who.clone());
        let amount = amount_with_inner_decimal.0;
        let shares = *self.accounts.get(&who).unwrap_or_else(|| env::panic_str("Account is not registered"));
        // shares to burn, rounded up (in RHEA's favour)
        let burn = mul_div(amount, self.pool_shares, self.pool_balance, true);
        require!(burn <= shares, "Withdraw error: Exceeded available amount");
        self.accounts.insert(who.clone(), shares - burn);
        self.pool_shares -= burn;
        self.pool_balance -= amount;
        let ft_amount = amount / EXTRA;
        require!(ft_amount > 0, "Withdraw amount can't be 0");
        Promise::new(self.usdc.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({ "receiver_id": recipient, "amount": U128(ft_amount) }).to_string().into_bytes(),
                NearToken::from_yoctonear(1),
                Gas::from_tgas(10),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).after_ft_transfer(who, U128(amount)))
    }

    #[private]
    pub fn after_ft_transfer(&mut self, account_id: AccountId, amount: U128) -> bool {
        if is_promise_success() {
            return true;
        }
        // re-deposit (RHEA: internal_deposit_without_asset_basic_check)
        let shares = self.accounts.get(&account_id).copied().unwrap_or(0);
        let minted = if self.pool_shares == 0 { amount.0 } else { mul_div(amount.0, self.pool_shares, self.pool_balance, false) };
        self.accounts.insert(account_id, shares + minted);
        self.pool_shares += minted;
        self.pool_balance += amount.0;
        false
    }

    // ───── test controls ─────
    /// Interest: grow every supplier's balance by `bps` (the test must also mint matching USDC to this contract).
    pub fn accrue(&mut self, bps: u32) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
        self.pool_balance += mul_div(self.pool_balance, bps as u128, 10_000, false);
    }
    /// Bad debt: shrink every supplier's balance by `bps`.
    pub fn lose(&mut self, bps: u32) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
        self.pool_balance -= mul_div(self.pool_balance, bps as u128, 10_000, false);
    }
    pub fn set_withdrawals_enabled(&mut self, enabled: bool) {
        require!(env::predecessor_account_id() == self.admin, "admin only");
        self.withdrawals_enabled = enabled;
    }
}
