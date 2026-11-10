//! TEST ONLY: a NEP-141 token standing in for USDC (6 decimals), built on near-contract-standards so
//! transfer, ft_transfer_call/resolve and storage registration behave exactly like a standard token.
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockUsdc {
    token: FungibleToken,
    minter: AccountId,
}

#[near]
impl MockUsdc {
    #[init]
    pub fn new(minter: AccountId) -> Self {
        Self { token: FungibleToken::new(b"t".to_vec()), minter }
    }
    /// Test helper: mint to a registered account.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.minter, "minter only");
        self.token.internal_deposit(&account_id, amount.0);
    }
    pub fn ft_metadata(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({ "spec": "ft-1.0.0", "name": "Mock USDC", "symbol": "USDC", "decimals": 6 })
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }
    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    pub fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.token.ft_resolve_transfer(sender_id, receiver_id, amount)
    }

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }
    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}
