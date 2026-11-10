//! Unit tests for authorisation, policy limits, locking and callback state transitions.
//! Callbacks are driven directly with mocked promise results; realistic end-to-end behaviour
//! (real cross-contract calls against mock USDC and mock RHEA) lives in contracts/integration.
use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};
use std::collections::HashMap;

const U: u128 = 1_000_000;
const T0: u64 = 1_800_000_000; // seconds

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("owner.near")
}
fn keeper() -> AccountId {
    acc("keeper.near")
}
fn usdc() -> AccountId {
    acc("usdc.near")
}
fn rhea() -> AccountId {
    acc("rhea.near")
}
fn vault_id() -> AccountId {
    acc("vault.near")
}

struct Ctx {
    pred: AccountId,
    deposit: NearToken,
    now: u64,
    results: Vec<PromiseResult>,
}
impl Ctx {
    fn new(pred: AccountId) -> Self {
        Ctx { pred, deposit: NearToken::from_yoctonear(0), now: T0, results: vec![] }
    }
    fn yocto(mut self) -> Self {
        self.deposit = ONE_YOCTO;
        self
    }
    fn at(mut self, t: u64) -> Self {
        self.now = t;
        self
    }
    fn results(mut self, r: Vec<PromiseResult>) -> Self {
        self.results = r;
        self
    }
    fn set(self) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(vault_id())
            .predecessor_account_id(self.pred.clone())
            .signer_account_id(self.pred)
            .attached_deposit(self.deposit)
            .prepaid_gas(Gas::from_tgas(300))
            .block_timestamp(self.now * 1_000_000_000);
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), HashMap::default(), self.results);
    }
}

/// RHEA get_account result for the vault with `micro` USDC supplied (18-decimal inner units).
fn rhea_result(micro: u128) -> PromiseResult {
    PromiseResult::Successful(
        json!({ "account_id": "vault.near", "supplied": [{ "token_id": "usdc.near", "balance": U128(micro * EXTRA_DECIMALS), "shares": U128(1) }] })
            .to_string()
            .into_bytes(),
    )
}
fn ok_bool(b: bool) -> PromiseResult {
    PromiseResult::Successful(serde_json::to_vec(&b).unwrap())
}
fn ok_unit() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn setup() -> Vault {
    Ctx::new(owner()).set();
    let mut v = Vault::new(owner(), keeper(), usdc(), rhea());
    v.approve_cause(acc("shelter.near"));
    v.approve_cause(acc("school.near"));
    v.set_deposits_public(true);
    v
}

/// Deposit and process at the given RHEA balance, returning the member view.
fn deposit_and_process(v: &mut Vault, who: &str, amount: u128, rhea_bal: u128) {
    Ctx::new(usdc()).set();
    let _ = v.ft_on_transfer(acc(who), U128(amount), String::new());
    Ctx::new(keeper()).set();
    let _ = v.process_deposits(vec![acc(who)]);
    Ctx::new(vault_id()).results(vec![rhea_result(rhea_bal)]).set();
    let _ = v.on_priced_process(vec![acc(who)]);
    // supply callback: RHEA keeps everything that was idle (the whole deposit)
    Ctx::new(vault_id()).results(vec![PromiseResult::Successful(serde_json::to_vec(&U128(amount)).unwrap())]).set();
    v.on_supplied(U128(amount));
    assert_eq!(v.idle, 0);
    assert!(v.lock.is_none());
}

fn member(v: &Vault, who: &str, rhea_bal: u128) -> MemberView {
    v.get_member(acc(who), Some(U128(rhea_bal))).unwrap()
}

// ───────────── deposits ─────────────

#[test]
#[should_panic(expected = "Only USDC is accepted")]
fn deposits_only_from_usdc() {
    let mut v = setup();
    Ctx::new(acc("fake.near")).set();
    let _ = v.ft_on_transfer(acc("alice.near"), U128(10 * U), String::new());
}

#[test]
#[should_panic(expected = "Deposits are not open yet")]
fn deposits_closed_by_default() {
    Ctx::new(owner()).set();
    let mut v = Vault::new(owner(), keeper(), usdc(), rhea());
    Ctx::new(usdc()).set();
    let _ = v.ft_on_transfer(acc("alice.near"), U128(10 * U), String::new());
}

#[test]
fn allowlisted_depositor_can_deposit_while_closed() {
    Ctx::new(owner()).set();
    let mut v = Vault::new(owner(), keeper(), usdc(), rhea());
    v.add_depositor(acc("team.near"));
    Ctx::new(usdc()).set();
    let _ = v.ft_on_transfer(acc("team.near"), U128(5 * U), String::new());
    assert_eq!(v.pending_deposits, 5 * U);
}

#[test]
#[should_panic(expected = "Minimum deposit is 1 USDC")]
fn minimum_deposit() {
    let mut v = setup();
    Ctx::new(usdc()).set();
    let _ = v.ft_on_transfer(acc("alice.near"), U128(U - 1), String::new());
}

#[test]
fn deposits_queue_then_mint_at_fair_price() {
    let mut v = setup();
    deposit_and_process(&mut v, "alice.near", 1000 * U, 0);
    // pool earned 10% in RHEA
    deposit_and_process(&mut v, "bob.near", 1000 * U, 1100 * U);
    let a = member(&v, "alice.near", 2100 * U);
    let b = member(&v, "bob.near", 2100 * U);
    assert_eq!(a.yield_amount.0, 99_999_999);
    assert_eq!(b.yield_amount.0, 0, "late depositor gets none of the earlier yield");
    assert_eq!(v.total_principal, 2000 * U);
}

#[test]
#[should_panic(expected = "Keeper only")]
fn only_keeper_processes() {
    let mut v = setup();
    Ctx::new(acc("alice.near")).set();
    let _ = v.process_deposits(vec![acc("alice.near")]);
}

// ───────────── withdrawals ─────────────

#[test]
#[should_panic(expected = "Requires your full-access key")]
fn withdraw_needs_full_key() {
    let mut v = setup();
    deposit_and_process(&mut v, "alice.near", 100 * U, 0);
    Ctx::new(acc("alice.near")).set(); // no yocto: a session key
    let _ = v.withdraw(None);
}

#[test]
fn withdraw_refuses_yield_and_restores_on_failure() {
    let mut v = setup();
    deposit_and_process(&mut v, "alice.near", 100 * U, 0);
    // ask for more than principal while there is yield: refused, nothing changes
    Ctx::new(acc("alice.near")).yocto().set();
    let _ = v.withdraw(Some(U128(100 * U + 1)));
    Ctx::new(vault_id()).results(vec![rhea_result(110 * U)]).set();
    let _ = v.on_priced_withdraw(acc("alice.near"), Some(U128(100 * U + 1)));
    assert!(v.lock.is_none());
    assert_eq!(member(&v, "alice.near", 110 * U).principal.0, 100 * U);

    // valid withdrawal, but RHEA's transfer fails: exact restore
    Ctx::new(acc("alice.near")).yocto().at(T0 + 120).set();
    let _ = v.withdraw(Some(U128(40 * U)));
    let before = (v.total_shares, v.total_principal);
    Ctx::new(vault_id()).results(vec![rhea_result(110 * U)]).at(T0 + 120).set();
    let _ = v.on_priced_withdraw(acc("alice.near"), Some(U128(40 * U)));
    assert!(v.total_shares < before.0);
    let m = v.members.get(&acc("alice.near")).unwrap();
    let burned = before.0 - v.total_shares;
    assert_eq!(m.principal, 60 * U);
    Ctx::new(vault_id()).results(vec![ok_bool(false)]).at(T0 + 120).set();
    let paid = v.on_withdrawn(acc("alice.near"), U128(40 * U), U128(burned), U128(40 * U), false);
    assert_eq!(paid.0, 0);
    assert_eq!((v.total_shares, v.total_principal), before);
    assert!(v.lock.is_none());
}

#[test]
#[should_panic(expected = "Withdrawals are temporarily paused")]
fn paused_withdrawals_block() {
    let mut v = setup();
    deposit_and_process(&mut v, "alice.near", 10 * U, 0);
    Ctx::new(owner()).set();
    v.pause_withdrawals(3600);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 10).set();
    let _ = v.withdraw(None);
}

#[test]
fn withdrawal_pause_is_bounded() {
    let mut v = setup();
    Ctx::new(owner()).set();
    v.pause_withdrawals(MAX_WITHDRAW_PAUSE_SEC);
    assert_eq!(v.withdrawals_paused_until_sec, T0 + MAX_WITHDRAW_PAUSE_SEC);
    // pausing again right after it ends is refused (cooldown)
    Ctx::new(owner()).at(T0 + MAX_WITHDRAW_PAUSE_SEC + 10).set();
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.pause_withdrawals(3600)));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "At most 72 hours")]
fn withdrawal_pause_max() {
    let mut v = setup();
    Ctx::new(owner()).set();
    v.pause_withdrawals(MAX_WITHDRAW_PAUSE_SEC + 1);
}

// ───────────── policy ─────────────

fn policy(allocs: &[(&str, u16)], cap: u128, auto: Option<AutoGrant>) -> Policy {
    Policy { allocations: allocs.iter().map(|(c, b)| Allocation { cause: acc(c), bps: *b }).collect(), session_daily_cap: U128(cap), auto }
}
fn grant(min: u128, max: u128, interval: u64) -> AutoGrant {
    AutoGrant { min_amount: U128(min), max_per_delivery: U128(max), min_interval_sec: interval, expires_at_sec: T0 + 30 * 86_400 }
}

#[test]
#[should_panic(expected = "Cause is not approved")]
fn policy_rejects_unapproved_cause() {
    let mut v = setup();
    Ctx::new(acc("alice.near")).yocto().set();
    v.set_policy(policy(&[("scam.near", 10_000)], 0, None));
}

#[test]
#[should_panic(expected = "add up to 100%")]
fn policy_must_sum_to_100() {
    let mut v = setup();
    Ctx::new(acc("alice.near")).yocto().set();
    v.set_policy(policy(&[("shelter.near", 6000), ("school.near", 3000)], 0, None));
}

#[test]
#[should_panic(expected = "Requires your full-access key")]
fn session_key_cannot_change_policy() {
    let mut v = setup();
    Ctx::new(acc("alice.near")).set();
    v.set_policy(policy(&[("shelter.near", 10_000)], 0, None));
}

#[test]
#[should_panic(expected = "Interval must be at least 10 minutes")]
fn grant_interval_floor() {
    let mut v = setup();
    Ctx::new(acc("alice.near")).yocto().set();
    v.set_policy(policy(&[("shelter.near", 10_000)], 0, Some(grant(1, 10, 60))));
}

// ───────────── donations ─────────────

fn with_yield(v: &mut Vault) {
    deposit_and_process(v, "alice.near", 1000 * U, 0);
    Ctx::new(acc("alice.near")).yocto().set();
    v.set_policy(policy(&[("shelter.near", 7000), ("school.near", 3000)], 5 * U, Some(grant(U, 50 * U, 3600))));
}

#[test]
#[should_panic(expected = "Session keys may only donate to your own chosen causes")]
fn session_key_limited_to_policy_causes() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(owner()).set();
    v.approve_cause(acc("other.near"));
    Ctx::new(acc("alice.near")).set();
    let _ = v.donate(vec![DonationRequest { cause: acc("other.near"), amount: U128(U) }]);
}

#[test]
#[should_panic(expected = "Over today's session donation cap")]
fn session_key_daily_cap() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(acc("alice.near")).set();
    let _ = v.donate(vec![DonationRequest { cause: acc("shelter.near"), amount: U128(6 * U) }]);
}

#[test]
fn full_key_donation_pays_and_records() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 100).set();
    let _ = v.donate(vec![DonationRequest { cause: acc("shelter.near"), amount: U128(30 * U) }]);
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 100).set();
    let shares_before = v.total_shares;
    let _ = v.on_priced_donate(acc("alice.near"), vec![DonationRequest { cause: acc("shelter.near"), amount: U128(30 * U) }], false);
    assert!(v.total_shares < shares_before);
    let id = v.payout_seq;
    assert_eq!(v.get_payout(id).unwrap().status, PayoutStatus::Pending);
    // nothing is recorded as donated before the transfer succeeds
    assert_eq!(v.total_donated, 0);
    let items = vec![Item { user: acc("alice.near"), cause: acc("shelter.near"), amount: U128(30 * U), shares: U128(shares_before - v.total_shares) }];
    // RHEA withdraw to vault succeeded
    Ctx::new(vault_id()).results(vec![ok_bool(true)]).at(T0 + 100).set();
    let _ = v.on_payout_withdrawn(id, items.clone(), U128(0));
    Ctx::new(vault_id()).results(vec![ok_unit()]).at(T0 + 100).set();
    v.on_payout_transfers(id, items, vec![acc("shelter.near")]);
    assert_eq!(v.get_payout(id).unwrap().status, PayoutStatus::Completed);
    assert_eq!(v.total_donated, 30 * U);
    assert_eq!(v.get_donated(acc("alice.near"), acc("shelter.near")).0, 30 * U);
    assert_eq!(v.get_cause(acc("shelter.near")).unwrap().donated.0, 30 * U);
    assert!(v.lock.is_none());
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"donation\"")));
}

#[test]
fn donation_beyond_yield_is_refused_at_execution() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 100).set();
    let req = vec![DonationRequest { cause: acc("shelter.near"), amount: U128(101 * U) }];
    let _ = v.donate(req.clone());
    let before = v.total_shares;
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 100).set();
    let _ = v.on_priced_donate(acc("alice.near"), req, false);
    assert_eq!(v.total_shares, before);
    assert_eq!(v.payout_seq, 0);
    assert!(v.lock.is_none());
}

#[test]
fn partial_payout_restores_only_failed_cause() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 100).set();
    let req = vec![
        DonationRequest { cause: acc("shelter.near"), amount: U128(20 * U) },
        DonationRequest { cause: acc("school.near"), amount: U128(10 * U) },
    ];
    let _ = v.donate(req.clone());
    let s0 = v.total_shares;
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 100).set();
    let _ = v.on_priced_donate(acc("alice.near"), req, false);
    let id = v.payout_seq;
    let s_after_burn = v.total_shares;
    let burn_total = s0 - s_after_burn;
    let a = 1100 * U;
    let s1 = shares_to_burn(20 * U, a, s0);
    let items = vec![
        Item { user: acc("alice.near"), cause: acc("shelter.near"), amount: U128(20 * U), shares: U128(s1) },
        Item { user: acc("alice.near"), cause: acc("school.near"), amount: U128(10 * U), shares: U128(burn_total - s1) },
    ];
    Ctx::new(vault_id()).results(vec![ok_bool(true)]).at(T0 + 100).set();
    let _ = v.on_payout_withdrawn(id, items.clone(), U128(0));
    // shelter transfer ok, school transfer failed (e.g. not storage-registered)
    Ctx::new(vault_id()).results(vec![ok_unit(), PromiseResult::Failed]).at(T0 + 100).set();
    v.on_payout_transfers(id, items, vec![acc("shelter.near"), acc("school.near")]);
    assert_eq!(v.get_payout(id).unwrap().status, PayoutStatus::Partial);
    assert_eq!(v.total_donated, 20 * U);
    assert_eq!(v.get_donated(acc("alice.near"), acc("school.near")).0, 0);
    assert_eq!(v.idle, 10 * U, "failed cause's tokens stay in the vault");
    assert_eq!(v.total_shares, s_after_burn + (burn_total - s1), "school shares restored");
}

#[test]
fn failed_rhea_withdraw_restores_everything() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 100).set();
    let req = vec![DonationRequest { cause: acc("shelter.near"), amount: U128(10 * U) }];
    let _ = v.donate(req.clone());
    let s0 = v.total_shares;
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 100).set();
    let _ = v.on_priced_donate(acc("alice.near"), req, false);
    let id = v.payout_seq;
    let items = vec![Item { user: acc("alice.near"), cause: acc("shelter.near"), amount: U128(10 * U), shares: U128(s0 - v.total_shares) }];
    Ctx::new(vault_id()).results(vec![ok_bool(false)]).at(T0 + 100).set();
    let _ = v.on_payout_withdrawn(id, items, U128(0));
    assert_eq!(v.total_shares, s0);
    assert_eq!(v.get_payout(id).unwrap().status, PayoutStatus::Failed);
    assert_eq!(v.total_donated, 0);
    assert!(v.lock.is_none());
}

// ───────────── keeper automation ─────────────

#[test]
#[should_panic(expected = "Keeper only")]
fn only_keeper_auto_delivers() {
    let mut v = setup();
    Ctx::new(owner()).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
}

#[test]
fn keeper_bounded_by_grant() {
    let mut v = setup();
    with_yield(&mut v);
    // 100 USDC of yield available, grant caps each delivery at 50, split 70/30 by the user's policy
    Ctx::new(keeper()).at(T0 + 4000).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 4000).set();
    let _ = v.on_priced_auto(vec![acc("alice.near")]);
    let id = v.payout_seq;
    assert_eq!(v.get_payout(id).unwrap().total.0, 50 * U);
    let logs = get_logs().join("\n");
    assert!(logs.contains("shelter.near") && logs.contains("35000000") && logs.contains("15000000"), "70/30 split of 50");
    // finish the payout from RHEA, then a second run inside the interval does nothing
    v.lock = None;
    Ctx::new(keeper()).at(T0 + 4100).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
    Ctx::new(vault_id()).results(vec![rhea_result(1050 * U)]).at(T0 + 4100).set();
    let _ = v.on_priced_auto(vec![acc("alice.near")]);
    assert_eq!(v.payout_seq, id, "min_interval enforced");
    assert!(v.lock.is_none());
}

#[test]
fn keeper_cannot_act_without_grant_or_after_expiry_or_revocation() {
    let mut v = setup();
    deposit_and_process(&mut v, "bob.near", 1000 * U, 0); // bob never granted anything
    with_yield(&mut v);
    Ctx::new(keeper()).at(T0 + 31 * 86_400).set(); // alice's grant expired
    let _ = v.auto_deliver(vec![acc("alice.near"), acc("bob.near")]);
    Ctx::new(vault_id()).results(vec![rhea_result(2200 * U)]).at(T0 + 31 * 86_400).set();
    let _ = v.on_priced_auto(vec![acc("alice.near"), acc("bob.near")]);
    assert_eq!(v.payout_seq, 0);

    // revoked before the keeper's batch prices
    Ctx::new(keeper()).at(T0 + 5000).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 5000).set();
    v.revoke_auto();
    Ctx::new(vault_id()).results(vec![rhea_result(2200 * U)]).at(T0 + 5000).set();
    let _ = v.on_priced_auto(vec![acc("alice.near")]);
    assert_eq!(v.payout_seq, 0);
}

#[test]
fn retired_cause_share_stays_with_supporter() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(owner()).set();
    v.retire_cause(acc("school.near"));
    Ctx::new(keeper()).at(T0 + 4000).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 4000).set();
    let _ = v.on_priced_auto(vec![acc("alice.near")]);
    assert_eq!(v.get_payout(v.payout_seq).unwrap().total.0, 35 * U, "only shelter's 70% of 50");
}

#[test]
fn keeper_has_no_power_over_a_supporters_principal_or_policy() {
    let mut v = setup();
    with_yield(&mut v);
    // every user-facing method acts on the CALLER's own position; the keeper has none
    Ctx::new(keeper()).yocto().set();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = v.withdraw(None);
    }))
    .is_err());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = v.donate(vec![DonationRequest { cause: acc("shelter.near"), amount: U128(U) }]);
    }))
    .is_err());
    let alice = v.members.get(&acc("alice.near")).unwrap();
    assert_eq!(alice.policy.allocations.len(), 2);
    assert_eq!(alice.principal, 1000 * U);
}

// ───────────── locking ─────────────

#[test]
#[should_panic(expected = "Vault busy")]
fn lock_blocks_concurrent_priced_ops() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(keeper()).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
    Ctx::new(acc("alice.near")).yocto().at(T0 + 100).set();
    let _ = v.withdraw(None);
}

#[test]
fn stale_lock_can_be_cleared_and_payout_flagged() {
    let mut v = setup();
    with_yield(&mut v);
    Ctx::new(keeper()).at(T0 + 4000).set();
    let _ = v.auto_deliver(vec![acc("alice.near")]);
    Ctx::new(vault_id()).results(vec![rhea_result(1100 * U)]).at(T0 + 4000).set();
    let _ = v.on_priced_auto(vec![acc("alice.near")]);
    let id = v.payout_seq;
    Ctx::new(acc("anyone.near")).at(T0 + 4000 + 100).set();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.unlock_stale())).is_err());
    Ctx::new(acc("anyone.near")).at(T0 + 4000 + LOCK_STALE_SEC + 1).set();
    v.unlock_stale();
    assert!(v.lock.is_none());
    assert_eq!(v.get_payout(id).unwrap().status, PayoutStatus::Stale);
}

#[test]
#[should_panic(expected = "Attach at least 290 TGas")]
fn locked_ops_require_enough_gas() {
    let mut v = setup();
    with_yield(&mut v);
    let mut b = VMContextBuilder::new();
    b.current_account_id(vault_id()).predecessor_account_id(keeper()).prepaid_gas(Gas::from_tgas(100)).block_timestamp(T0 * 1_000_000_000);
    testing_env!(b.build());
    let _ = v.auto_deliver(vec![acc("alice.near")]);
}

#[test]
#[should_panic(expected = "Owner only")]
fn keeper_cannot_approve_causes() {
    let mut v = setup();
    Ctx::new(keeper()).set();
    v.approve_cause(acc("evil.near"));
}

#[test]
#[should_panic(expected = "Not allowed")]
fn keeper_cannot_unpause() {
    let mut v = setup();
    Ctx::new(keeper()).set();
    v.set_donations_paused(true);
    v.set_donations_paused(false);
}
