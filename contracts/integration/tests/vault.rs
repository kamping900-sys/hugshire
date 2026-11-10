//! Hugshire Vault v2 in a NEAR sandbox, against a standard NEP-141 token (mock USDC) and a
//! behavioural RHEA mock. Every call is a real transaction with real cross-contract promises.
//!
//! Run (from contracts/):
//!   cargo build -p hugshire-vault -p mock-usdc -p mock-rhea --target wasm32-unknown-unknown --release
//!   WASM_DIR=<target>/wasm32-unknown-unknown/release cargo test -p hugshire-integration -- --test-threads=1
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const U: u128 = 1_000_000;
const TGAS300: Gas = Gas::from_tgas(300);
const YOCTO: NearToken = NearToken::from_yoctonear(1);

struct H {
    worker: Worker<Sandbox>,
    usdc: Contract,
    rhea: Contract,
    vault: Contract,
    admin: Account,
    owner: Account,
    keeper: Account,
    alice: Account,
    bob: Account,
    shelter: Account,
    school: Account,
    unregistered_cause: Account,
}

fn wasm(name: &str) -> Vec<u8> {
    let dir = std::env::var("WASM_DIR").expect("set WASM_DIR to the wasm32 release target dir");
    std::fs::read(format!("{dir}/{name}.wasm")).unwrap_or_else(|e| panic!("{name}.wasm: {e}"))
}

async fn ok(r: ExecutionFinalResult) -> ExecutionFinalResult {
    assert!(r.is_success(), "transaction failed: {:#?}", r.failures());
    r
}

async fn sub(worker: &Worker<Sandbox>, name: &str) -> anyhow::Result<Account> {
    Ok(worker.root_account()?.create_subaccount(name).initial_balance(NearToken::from_near(30)).transact().await?.into_result()?)
}

impl H {
    async fn new() -> anyhow::Result<H> {
        let worker = near_workspaces::sandbox().await?;
        let admin = sub(&worker, "admin").await?;
        let owner = sub(&worker, "owner").await?;
        let keeper = sub(&worker, "keeper").await?;
        let alice = sub(&worker, "alice").await?;
        let bob = sub(&worker, "bob").await?;
        let shelter = sub(&worker, "shelter").await?;
        let school = sub(&worker, "school").await?;
        let unregistered_cause = sub(&worker, "nostorage").await?;

        let usdc = worker.dev_deploy(&wasm("mock_usdc")).await?;
        ok(usdc.call("new").args_json(json!({ "minter": admin.id() })).transact().await?).await;
        let rhea = worker.dev_deploy(&wasm("mock_rhea")).await?;
        ok(rhea.call("new").args_json(json!({ "admin": admin.id(), "usdc": usdc.id() })).transact().await?).await;
        let vault = worker.dev_deploy(&wasm("hugshire_vault")).await?;
        ok(vault
            .call("new")
            .args_json(json!({ "owner_id": owner.id(), "keeper_id": keeper.id(), "usdc": usdc.id(), "rhea": rhea.id() }))
            .transact()
            .await?)
        .await;

        let h = H { worker, usdc, rhea, vault, admin, owner, keeper, alice, bob, shelter, school, unregistered_cause };
        // storage registrations (the cause without USDC storage is deliberately left unregistered)
        for id in [h.vault.id(), h.rhea.id(), h.alice.id(), h.bob.id(), h.shelter.id(), h.school.id()] {
            ok(h.admin.call(h.usdc.id(), "storage_deposit").args_json(json!({ "account_id": id })).deposit(NearToken::from_millinear(13)).transact().await?).await;
        }
        ok(h.admin.call(h.rhea.id(), "storage_deposit").args_json(json!({ "account_id": h.vault.id() })).deposit(NearToken::from_millinear(100)).transact().await?).await;
        // balances: users, and a reserve inside RHEA to back simulated interest
        for (who, amt) in [(h.alice.id(), 5_000 * U), (h.bob.id(), 5_000 * U), (h.rhea.id(), 1_000_000 * U)] {
            ok(h.admin.call(h.usdc.id(), "mint").args_json(json!({ "account_id": who, "amount": amt.to_string() })).transact().await?).await;
        }
        for c in [h.shelter.id(), h.school.id(), h.unregistered_cause.id()] {
            ok(h.owner.call(h.vault.id(), "approve_cause").args_json(json!({ "account_id": c })).transact().await?).await;
        }
        ok(h.owner.call(h.vault.id(), "set_deposits_public").args_json(json!({ "public": true })).transact().await?).await;
        Ok(h)
    }

    async fn usdc_of(&self, who: &Account) -> u128 {
        let v: String = self.usdc.view("ft_balance_of").args_json(json!({ "account_id": who.id() })).await.unwrap().json().unwrap();
        v.parse().unwrap()
    }
    async fn usdc_of_id(&self, id: &near_workspaces::AccountId) -> u128 {
        let v: String = self.usdc.view("ft_balance_of").args_json(json!({ "account_id": id })).await.unwrap().json().unwrap();
        v.parse().unwrap()
    }
    async fn rhea_supplied(&self) -> u128 {
        let v: Value = self.rhea.view("get_account").args_json(json!({ "account_id": self.vault.id() })).await.unwrap().json().unwrap();
        v["supplied"].as_array().and_then(|a| a.first()).map(|s| s["balance"].as_str().unwrap().parse::<u128>().unwrap() / 1_000_000_000_000).unwrap_or(0)
    }
    async fn member(&self, who: &Account) -> Value {
        let r = self.rhea_supplied().await;
        self.vault.view("get_member").args_json(json!({ "account_id": who.id(), "rhea_supplied": r.to_string() })).await.unwrap().json().unwrap()
    }
    async fn totals(&self) -> Value {
        self.vault.view("get_totals").args_json(json!({})).await.unwrap().json().unwrap()
    }
    async fn deposit(&self, who: &Account, amount: u128) {
        ok(who
            .call(self.usdc.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.vault.id(), "amount": amount.to_string(), "msg": "" }))
            .deposit(YOCTO)
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .unwrap())
        .await;
    }
    async fn process(&self, who: &[&Account]) {
        let ids: Vec<_> = who.iter().map(|a| a.id().clone()).collect();
        ok(self.keeper.call(self.vault.id(), "process_deposits").args_json(json!({ "accounts": ids })).gas(TGAS300).transact().await.unwrap()).await;
    }
    /// Pool interest; the mock's USDC reserve backs it.
    async fn accrue(&self, bps: u32) {
        ok(self.admin.call(self.rhea.id(), "accrue").args_json(json!({ "bps": bps })).transact().await.unwrap()).await;
    }
    /// Advance sandbox time by at least `secs` seconds (fast-forwarded blocks are not one second each).
    async fn wait(&self, secs: u64) {
        let start = self.worker.view_block().await.unwrap().timestamp();
        loop {
            self.worker.fast_forward(200).await.unwrap();
            if self.worker.view_block().await.unwrap().timestamp() >= start + secs * 1_000_000_000 {
                break;
            }
        }
    }
    async fn set_policy(&self, who: &Account, policy: Value) -> ExecutionFinalResult {
        who.call(self.vault.id(), "set_policy").args_json(json!({ "policy": policy })).deposit(YOCTO).transact().await.unwrap()
    }
    async fn donate(&self, who: &Account, reqs: Value, full_key: bool) -> ExecutionFinalResult {
        let c = who.call(self.vault.id(), "donate").args_json(json!({ "requests": reqs })).gas(TGAS300);
        let c = if full_key { c.deposit(YOCTO) } else { c };
        c.transact().await.unwrap()
    }
    fn u(v: &Value, k: &str) -> u128 {
        v[k].as_str().unwrap().parse().unwrap()
    }
    /// Invariants that must hold whenever the vault is unlocked.
    async fn check_invariants(&self, members: &[&Account]) {
        let t = self.totals().await;
        assert!(t["locked"].is_null(), "vault left locked: {t}");
        let mut shares = 0u128;
        let mut principal = 0u128;
        let mut values = 0u128;
        for m in members {
            let v = self.member(m).await;
            if v.is_null() {
                continue;
            }
            shares += Self::u(&v, "shares");
            principal += Self::u(&v, "principal");
            values += Self::u(&v, "value");
        }
        assert_eq!(shares, Self::u(&t, "total_shares"), "Σ shares == total_shares");
        assert_eq!(principal, Self::u(&t, "total_principal"), "Σ principal == total_principal");
        let assets = self.rhea_supplied().await + Self::u(&t, "idle");
        assert!(values <= assets, "Σ value ({values}) <= assets ({assets})");
        // the vault's own USDC balance is exactly idle + pending deposits (nothing unaccounted, nothing missing)
        assert_eq!(self.usdc_of_id(self.vault.id()).await, Self::u(&t, "idle") + Self::u(&t, "pending_deposits"), "token balance reconciles");
    }
}

fn near_eq(a: u128, b: u128, tol: u128) -> bool {
    a.max(b) - a.min(b) <= tol
}

#[tokio::test]
async fn deposits_mint_fair_shares_and_yield_is_per_user() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    let t = h.totals().await;
    assert_eq!(H::u(&t, "pending_deposits"), 1_000 * U, "deposit queued, not yet shares");
    h.process(&[&h.alice]).await;
    assert_eq!(h.rhea_supplied().await, 1_000 * U, "supplied to RHEA");
    h.accrue(1_000).await; // +10%
    h.deposit(&h.bob, 1_000 * U).await;
    h.process(&[&h.bob]).await;
    h.accrue(500).await; // +5%
    let a = h.member(&h.alice).await;
    let b = h.member(&h.bob).await;
    assert!(near_eq(H::u(&a, "yield_amount"), 155 * U, 5), "alice yield {a}");
    assert!(near_eq(H::u(&b, "yield_amount"), 50 * U, 5), "bob yield {b}");
    h.check_invariants(&[&h.alice, &h.bob]).await;
    Ok(())
}

#[tokio::test]
async fn donation_pays_cause_records_it_and_leaves_others_untouched() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    h.deposit(&h.bob, 1_000 * U).await;
    h.process(&[&h.alice, &h.bob]).await;
    h.accrue(1_000).await;
    let bob_before = H::u(&h.member(&h.bob).await, "value");
    let shelter_before = h.usdc_of(&h.shelter).await;
    let y = H::u(&h.member(&h.alice).await, "yield_amount");
    let r = ok(h.donate(&h.alice, json!([{ "cause": h.shelter.id(), "amount": y.to_string() }]), true).await).await;
    assert!(r.logs().iter().any(|l| l.contains("\"event\":\"donation\"")), "donation event emitted");
    assert_eq!(h.usdc_of(&h.shelter).await - shelter_before, y, "cause received exactly the donated yield");
    let d: String = h.vault.view("get_donated").args_json(json!({ "user": h.alice.id(), "cause": h.shelter.id() })).await?.json()?;
    assert_eq!(d.parse::<u128>()?, y);
    let p: Value = h.vault.view("get_payout").args_json(json!({ "id": 1 })).await?.json()?;
    assert_eq!(p["status"], "Completed");
    assert!(near_eq(H::u(&h.member(&h.bob).await, "value"), bob_before, 2), "bob unaffected");
    assert!(near_eq(H::u(&h.member(&h.alice).await, "value"), 1_000 * U, 2), "alice back to her principal");
    h.check_invariants(&[&h.alice, &h.bob]).await;
    Ok(())
}

#[tokio::test]
async fn withdraw_principal_only_and_losses_are_shared() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    h.deposit(&h.bob, 1_000 * U).await;
    h.process(&[&h.alice, &h.bob]).await;
    h.accrue(1_000).await;
    // trying to take yield out is refused; balance unchanged
    let before = h.usdc_of(&h.bob).await;
    let r = h.bob.call(h.vault.id(), "withdraw").args_json(json!({ "amount": (1_000 * U + 1).to_string() })).deposit(YOCTO).gas(TGAS300).transact().await?;
    assert!(r.logs().iter().any(|l| l.contains("withdraw_refused")));
    assert_eq!(h.usdc_of(&h.bob).await, before);
    // partial principal withdrawal keeps yield committed
    h.wait(70).await;
    let y = H::u(&h.member(&h.bob).await, "yield_amount");
    ok(h.bob.call(h.vault.id(), "withdraw").args_json(json!({ "amount": (400 * U).to_string() })).deposit(YOCTO).gas(TGAS300).transact().await?).await;
    assert_eq!(h.usdc_of(&h.bob).await - before, 400 * U);
    assert!(near_eq(H::u(&h.member(&h.bob).await, "yield_amount"), y, 2));
    // 20% bad debt: nothing is donatable, exits are pro-rata
    ok(h.admin.call(h.rhea.id(), "lose").args_json(json!({ "bps": 2000 })).transact().await?).await;
    let a = h.member(&h.alice).await;
    assert_eq!(H::u(&a, "yield_amount"), 0);
    let r = h.donate(&h.alice, json!([{ "cause": h.shelter.id(), "amount": "1" }]), true).await;
    assert!(r.logs().iter().any(|l| l.contains("donation_refused")), "no donation from a loss");
    let alice_before = h.usdc_of(&h.alice).await;
    h.wait(70).await;
    let w = H::u(&h.member(&h.alice).await, "withdrawable");
    assert!(near_eq(w, 880 * U, 5), "1100 × 0.8 = 880, got {w}");
    ok(h.alice.call(h.vault.id(), "withdraw").args_json(json!({ "amount": null })).deposit(YOCTO).gas(TGAS300).transact().await?).await;
    assert!(near_eq(h.usdc_of(&h.alice).await - alice_before, w, 2));
    h.check_invariants(&[&h.alice, &h.bob]).await;
    Ok(())
}

#[tokio::test]
async fn failed_transfers_restore_exact_state() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    h.process(&[&h.alice]).await;
    h.accrue(1_000).await;
    // the cause is approved but has no USDC storage: RHEA→vault succeeds, vault→cause fails
    let m0 = h.member(&h.alice).await;
    let r = ok(h.donate(&h.alice, json!([{ "cause": h.unregistered_cause.id(), "amount": (10 * U).to_string() }]), true).await).await;
    assert!(r.logs().iter().any(|l| l.contains("payout_finished") && l.contains("Failed")));
    let m1 = h.member(&h.alice).await;
    assert_eq!(H::u(&m1, "shares"), H::u(&m0, "shares"), "shares restored");
    assert_eq!(H::u(&m1, "donated"), 0, "nothing recorded as donated");
    assert_eq!(H::u(&h.totals().await, "total_donated"), 0);
    h.check_invariants(&[&h.alice]).await;

    // RHEA withdrawals frozen: the user's withdrawal fails and is fully restored
    ok(h.admin.call(h.rhea.id(), "set_withdrawals_enabled").args_json(json!({ "enabled": false })).transact().await?).await;
    ok(h.keeper.call(h.vault.id(), "supply").gas(TGAS300).transact().await?).await; // move the returned 10 back into RHEA
    h.wait(70).await;
    let bal = h.usdc_of(&h.alice).await;
    let p0 = H::u(&h.member(&h.alice).await, "principal");
    let r = h.alice.call(h.vault.id(), "withdraw").args_json(json!({ "amount": (100 * U).to_string() })).deposit(YOCTO).gas(TGAS300).transact().await?;
    assert!(r.logs().iter().any(|l| l.contains("withdraw_failed")), "logs: {:?}", r.logs());
    assert_eq!(h.usdc_of(&h.alice).await, bal);
    assert_eq!(H::u(&h.member(&h.alice).await, "principal"), p0);
    h.check_invariants(&[&h.alice]).await;
    Ok(())
}

#[tokio::test]
async fn keeper_is_bounded_by_user_grants() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    h.deposit(&h.bob, 1_000 * U).await;
    h.process(&[&h.alice, &h.bob]).await;
    h.accrue(1_000).await;
    let now = h.worker.view_block().await?.timestamp() / 1_000_000_000;
    ok(h.set_policy(
        &h.alice,
        json!({
            "allocations": [{ "cause": h.shelter.id(), "bps": 7000 }, { "cause": h.school.id(), "bps": 3000 }],
            "session_daily_cap": "0",
            "auto": { "min_amount": (U).to_string(), "max_per_delivery": (40 * U).to_string(), "min_interval_sec": 600, "expires_at_sec": now + 86_400 }
        }),
    )
    .await)
    .await;
    // a malicious owner approves its own account; it can't make anyone's yield go there
    let evil = sub(&h.worker, "evil").await?;
    ok(h.owner.call(h.vault.id(), "approve_cause").args_json(json!({ "account_id": evil.id() })).transact().await?).await;
    ok(h.admin.call(h.usdc.id(), "storage_deposit").args_json(json!({ "account_id": evil.id() })).deposit(NearToken::from_millinear(13)).transact().await?).await;

    let (s0, c0) = (h.usdc_of(&h.shelter).await, h.usdc_of(&h.school).await);
    let bob0 = h.member(&h.bob).await;
    ok(h.keeper.call(h.vault.id(), "auto_deliver").args_json(json!({ "accounts": [h.alice.id(), h.bob.id()] })).gas(TGAS300).transact().await?).await;
    assert_eq!(h.usdc_of(&h.shelter).await - s0, 28 * U, "70% of the 40 cap");
    assert_eq!(h.usdc_of(&h.school).await - c0, 12 * U, "30% of the 40 cap");
    assert_eq!(h.usdc_of(&evil).await, 0);
    assert_eq!(h.member(&h.bob).await["shares"], bob0["shares"], "bob granted nothing: untouched");
    // again inside the interval: nothing happens (replay / rate protection)
    ok(h.keeper.call(h.vault.id(), "auto_deliver").args_json(json!({ "accounts": [h.alice.id()] })).gas(TGAS300).transact().await?).await;
    assert_eq!(h.usdc_of(&h.shelter).await - s0, 28 * U);
    // revoked: the keeper can do nothing even after the interval
    ok(h.alice.call(h.vault.id(), "revoke_auto").deposit(YOCTO).transact().await?).await;
    h.wait(700).await;
    ok(h.keeper.call(h.vault.id(), "auto_deliver").args_json(json!({ "accounts": [h.alice.id()] })).gas(TGAS300).transact().await?).await;
    assert_eq!(h.usdc_of(&h.shelter).await - s0, 28 * U);
    // the keeper cannot use the user-facing methods on anyone else's behalf
    let r = h.keeper.call(h.vault.id(), "withdraw").args_json(json!({ "amount": null })).deposit(YOCTO).gas(TGAS300).transact().await?;
    assert!(r.is_failure());
    h.check_invariants(&[&h.alice, &h.bob]).await;
    Ok(())
}

#[tokio::test]
async fn session_key_is_scoped_by_the_protocol_and_the_contract() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    h.process(&[&h.alice]).await;
    h.accrue(1_000).await;
    ok(h.set_policy(&h.alice, json!({ "allocations": [{ "cause": h.shelter.id(), "bps": 10000 }], "session_daily_cap": (5 * U).to_string(), "auto": null })).await).await;
    // Alice adds a function-call key for the game: receiver = vault, method = donate
    let sk = SecretKey::from_random(KeyType::ED25519);
    ok(h.alice
        .batch(h.alice.id())
        .add_key(sk.public_key(), AccessKey::function_call_access(h.vault.id(), &["donate"], Some(NearToken::from_near(1))))
        .transact()
        .await?)
    .await;
    let game = Account::from_secret_key(h.alice.id().clone(), sk, &h.worker);
    let s0 = h.usdc_of(&h.shelter).await;
    ok(h.donate(&game, json!([{ "cause": h.shelter.id(), "amount": (2 * U).to_string() }]), false).await).await;
    assert_eq!(h.usdc_of(&h.shelter).await - s0, 2 * U, "game delivery within policy works");
    // to an approved cause outside her policy: refused by the contract
    h.wait(70).await;
    let r = h.donate(&game, json!([{ "cause": h.school.id(), "amount": (U).to_string() }]), false).await;
    assert!(r.is_failure());
    // above the daily cap: refused
    let r = h.donate(&game, json!([{ "cause": h.shelter.id(), "amount": (4 * U).to_string() }]), false).await;
    assert!(r.is_failure());
    // withdraw with the session key: the protocol forbids deposits on function-call keys, and the method isn't allowed
    let r = game.call(h.vault.id(), "withdraw").args_json(json!({ "amount": null })).deposit(YOCTO).gas(TGAS300).transact().await;
    assert!(r.is_err() || r.unwrap().is_failure());
    h.check_invariants(&[&h.alice]).await;
    Ok(())
}

#[tokio::test]
async fn callbacks_are_private_and_payout_ids_unique() -> anyhow::Result<()> {
    let h = H::new().await?;
    h.deposit(&h.alice, 1_000 * U).await;
    h.process(&[&h.alice]).await;
    h.accrue(1_000).await;
    ok(h.donate(&h.alice, json!([{ "cause": h.shelter.id(), "amount": (U).to_string() }]), true).await).await;
    h.wait(70).await;
    ok(h.donate(&h.alice, json!([{ "cause": h.shelter.id(), "amount": (U).to_string() }]), true).await).await;
    assert_eq!(h.totals().await["payout_seq"], 2);
    // forging a "transfer succeeded" callback from outside is impossible
    let forged = h
        .bob
        .call(h.vault.id(), "on_payout_transfers")
        .args_json(json!({ "payout_id": 2, "items": [{ "user": h.bob.id(), "cause": h.shelter.id(), "amount": "1000000", "shares": "1" }], "causes": [h.shelter.id()] }))
        .gas(TGAS300)
        .transact()
        .await?;
    assert!(forged.is_failure());
    let forged = h.bob.call(h.vault.id(), "on_priced_withdraw").args_json(json!({ "owner": h.alice.id(), "amount": null })).gas(TGAS300).transact().await?;
    assert!(forged.is_failure());
    // a direct USDC transfer to the vault does not change anyone's value (no inflation)
    let v0 = h.member(&h.alice).await["value"].clone();
    ok(h.bob.call(h.usdc.id(), "ft_transfer").args_json(json!({ "receiver_id": h.vault.id(), "amount": (500 * U).to_string() })).deposit(YOCTO).transact().await?).await;
    assert_eq!(h.member(&h.alice).await["value"], v0);
    Ok(())
}
