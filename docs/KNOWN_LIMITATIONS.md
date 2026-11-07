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

## Not production-hardened yet

6. Vault contract **not audited**. No on-chain TVL cap. `used_memos` grows without bound.
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
