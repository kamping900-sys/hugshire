# Known limitations (2026-11-07)

Plainly stated, so nothing here is mistaken for done.

## Blocked on your accounts or approvals

1. **Privy client integration is not built.** The server verifies Privy tokens (`/api/auth/privy`)
   and every user-signed step has a server endpoint that verifies on chain (`/api/live`,
   `verifyVaultDeposits`, `verifyVaultWithdrawals`). Still missing:
   - the `PrivyProvider` login UI;
   - `PrivyWallets.getUserWallets`;
   - the three signing prompts (Base transfer to 1Click, `ft_transfer_call` into the Vault,
     `vault.withdraw`).

   `@privy-io/react-auth` currently has a peer conflict with `@coinbase/cdp-sdk` over `ox`. Needs: a
   Privy app.
2. **User NEAR gas.** New implicit accounts have 0 NEAR. Choose operator-funded accounts or a NEP-366
   relayer (SETUP_GUIDE §3).
3. **Coinbase:** trial mode until KYB approval. Hosted guest checkout was scheduled for deprecation
   on 2026-06-30, so check current availability. Offramp's return leg (`offramp_processing` →
   `completed` from `offramp.transaction.success`) is not wired yet.
4. **Withdrawal bridge-back leg (NEAR → Base)** has provider support (`OneClickBridge` with
   `to_base`) but no orchestration step or UI yet.
5. **Operator `supply` call** is not scheduled by a job. Idle USDC in the Vault must be supplied with
   a manual call, or by a small job to add (`VaultLending` plus `NearRpc.functionCall`).

## Vault v2 status (2026-11-08)

- **v2 contract:** written and tested. 42 unit tests cover the share math, authorisation rules,
  keeper limits, locking and the callback state transitions. 7 NEAR-sandbox integration tests (all
  passing) run it against a standard NEP-141 token and a RHEA mock that follows RHEA v0.15.7
  semantics.
- **Never deployed, not audited.** Mainnet RHEA is v0.16.2, which has no public source. Its
  behaviour must be confirmed with the controlled small-value test (VAULT_V2.md §8).
- **The app's live path is only partly migrated to v2:**
  - Done: event parsing, deposit verification, pool valuation, and switching off database-driven
    payouts for live funds.
  - Still to do:
    - Make the portfolio read per-user shares and yield from `get_member`, instead of the
      principal-based ledger.
    - Add a keeper job that calls `process_deposits` and `auto_deliver` for supporters the app
      sees as idle.
    - Add a client signing flow for `set_policy`, the session key and `donate`. This depends on
      the Privy client integration.
- **Product and legal decision:** yield is committed to charity. Supporters can withdraw principal
  only. This must be in the signed deposit terms and reviewed by counsel.

## Not production-hardened yet

6. Vault contract **not audited**. No on-chain TVL cap yet (deposits are allowlist-only until review).
7. No Content-Security-Policy header.
8. Rate limiting is in-process, so it is only correct with one web instance.
9. Alerts are stored and shown in `/admin` but are not pushed to Slack, email or phone.
10. The operator key lives in an env var, not a KMS.
11. There is no email delivery. Dev sign-in shows codes on screen and in the log; live uses Privy's
    own emails.
12. Organisation KYB evidence is collected outside the app. The portal records only status and an
    EIN field.
13. `defaultNetwork`, `defaultAsset` and `presetFiatAmount` in the Coinbase URL were not confirmed in
    the docs read.
14. Webhook payload field names (`eventType`, `partnerUserRef`, `purchaseAmount`, `transactionId`)
    follow the Coinbase samples. Verify them against a real event. Unmatched or ambiguous events are
    never guessed: they raise an `onramp_unmatched` alert.

## Product and design

15. Art is original placeholder vector art drawn in code (`src/lib/animals.ts`, `src/game/art.ts`).
    Final mascot assets are pending. Replace them by swapping the texture bank; the game logic does
    not depend on the art.
16. The city stage is symbolic: it reflects real yield paid against a symbolic goal. The UI says so.
17. City scenes are a fixed 26×18 layout with stage-based props. There is no world editor (by design).
18. In a hidden or background browser tab the game pauses (intentional). Automated screenshots of
    moving helpers need a visible window.
19. One helper is created per deposit (setting `helperRule`; `one_per_cause` is also supported).

## Verified on 2026-11-07

- 46 unit tests (ledger, yield, deliveries, auto mode, payouts, withdrawals, reconciliation, auth,
  webhooks, uploads, game logic).
- 9 contract tests.
- 5 end-to-end flows in Chromium, on desktop and mobile viewports.
- Read-only live checks:
  - RHEA USDC: APR 8.96%, deposits and withdrawals enabled, `extra_decimals` 12.
  - 1Click: both USDC assets listed, and a dry quote of 10 USDC Base→NEAR returns 9.998 USDC in
    about 35 seconds.

## V4 gameplay, economy and social money (2026-11-11)

Details are in V4_GAMEPLAY_ECONOMY.md §11.

- **Community Heart Pool** works end to end in sandbox: simulated revenue and a database stand-in for
  the DAO. Live mode still needs:
  - a Sputnik DAO (manageable in Trezu), with Hugshire holding only the proposer role;
  - a real ad network that has passed policy review;
  - a privacy-preserving uniqueness provider.

  The Sputnik adapter is written but has not been run against mainnet.
- **Ads:** only the simulated provider exists. Real ads are disabled by setting.
- **Multiplayer presence** is in memory, so it only works with one web instance.
- **Rhythm-game anti-cheat** is server-side but can't prove a human is playing. The stakes are capped
  virtual resources only.
- **Mini-game visuals** are drawn in code plus the existing mascot side sprites. There are no bespoke
  chop or strike animation frames yet.
- **Uniqueness** in sandbox is a stand-in attestation (a salted hash of the email). It is not proof
  of personhood.
