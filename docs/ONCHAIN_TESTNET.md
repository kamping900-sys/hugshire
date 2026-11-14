# Onchain on NEAR testnet

With `CHAIN_MODE=testnet`, the money in Hugshire moves onchain. Player actions in the game become real NEAR testnet transactions:
- deposits into the Hugshire Vault
- lending
- donations to causes
- withdrawals
- Community Pool payouts

Anyone can verify them on the testnet explorer.

## Contracts and accounts

| What | Account | Notes |
|---|---|---|
| **Hugshire Vault** (our contract, `contracts/vault`) | `vault.hugshire-demo-s5q1.testnet` | Owner: `hugshire-demo-s5q1.testnet`. Keeper: `keeper.hugshire-ops-s5q1.testnet` |
| Test USDC (`contracts/mock-ft`) | `usdc.hugshire-demo-s5q1.testnet` | 6 decimals. Minter: the ops account |
| Mock RHEA lending pool (`contracts/mock-rhea`) | `rhea.hugshire-demo-s5q1.testnet` | Same interface as RHEA (`ft_on_transfer`, `get_account`, `simple_withdraw`) |
| Cause wallets | `pawsbury.` / `inkwell-hollow.` / `fernhollow.` / `ladle-lane.hugshire-ops-s5q1.testnet` | Approved causes in the Vault |
| Community treasury | `p21fdb4c69f9a.hugshire-ops-s5q1.testnet` | Pays Community Heart Pool shares |
| Player wallets | `p<hash>.hugshire-ops-s5q1.testnet` | One per player. The key is derived from `CHAIN_WALLET_SECRET` (nothing stored) |

**Explorer:** https://testnet.nearblocks.io/address/vault.hugshire-demo-s5q1.testnet

## What happens onchain

| Game action | Onchain transactions |
|---|---|
| Plant a deposit (test checkout) | Test USDC is minted to the player's wallet, then the wallet sends it to the Vault (`ft_transfer_call`), then the keeper calls `process_deposits`, which mints shares and supplies the funds to RHEA in the same transaction |
| Interest | The pool's borrowers' USDC arrives in mock RHEA (`mint`), then `accrue()` raises every supplier's balance |
| Send Heart Tree fruit to a town | The player's wallet calls `vault.donate`, so the Vault withdraws from RHEA and **transfers USDC to the cause's wallet** |
| Withdraw | The player's wallet calls `vault.withdraw`, so **USDC returns to the player's wallet** |
| Community Heart Pool payout | The treasury wallet receives the month's budget, then **transfers each cause's share to its wallet** |

Each transaction hash is stored in `chain_txs` and shown in the Heart Tree, under **My deposit → Onchain · NEAR testnet**, with explorer links.

**Verified runs:**
- deposit: [to Vault](https://testnet.nearblocks.io/txns/7wXBF1es7kfm8FQyS5H3aBEnCAGdT78iU1nXfFnwVoTd)
- donation to Fernhollow: [donate](https://testnet.nearblocks.io/txns/8dZDpPUM5XHG3z11zV6vYR9S8Z7iB3Sc6BqSYb6iWFbg)
- withdrawal: [withdraw](https://testnet.nearblocks.io/txns/HK7HQutwetrJjbNY1gu6fWbDk61GYjL851bTZwWuTR4R)
- pool payout to Pawsbury: [payout](https://testnet.nearblocks.io/txns/EBuY3mraEHzhteFTtfgLc29UMRvmLwbqBmqcaEzXoDAZ)

## What is still not onchain, and why

| Leg | Status | Why |
|---|---|---|
| Card payment (Coinbase Onramp) | simulated | Coinbase has no testnet that delivers tokens. Live use needs KYB approval |
| Base → NEAR bridge (NEAR Intents 1Click) | simulated; test USDC is minted to the player's wallet instead | 1Click runs on mainnet only |
| Real RHEA lending | **mock RHEA** on testnet | RHEA lending runs on mainnet only. The mock uses the same calls, but its interest is triggered by the demo, not by real borrowers |
| Interest amount | mock interest tops up to cover what the player donates | The game's yield is calculated from RHEA's real mainnet rate; the testnet pool is topped up to match |
| NEAR → Base bridge and bank payout (Coinbase Offramp) | simulated after the Vault withdrawal | mainnet only / KYB |
| Player wallets | **held by the server** for the demo | In production, players sign with their own Privy wallets. That sign-in screen isn't built yet |
| Community Pool ad revenue | simulated; the treasury is funded with test USDC | There's no live ad network yet |
| Community treasury as a Sputnik DAO with council votes | a single treasury wallet on testnet | The DAO (Trezu) isn't set up |
| Real money and USDC value | none: testnet tokens are worthless | by design |

**Nothing here is a mainnet deployment.** The Vault is still unaudited.

## Running it

**One-time setup** (already done):

```bash
npx tsx scripts/testnet-setup.ts hugshire-demo-s5q1.testnet hugshire-ops-s5q1.testnet
```

**Locally**, a dev server in onchain mode on port 3400:

```bash
node scripts/dev-chain.cjs
```

**Railway:** add the variables from `.data/chain/railway.env` (gitignored, testnet keys only) to the web service, then redeploy. The mirror runs alongside the app's built-in jobs (`HUGSHIRE_INPROCESS_WORKER=1`).

**Checks:**
- `npx tsx scripts/testnet-demo.ts`: the whole loop on the contracts.
- `node scripts/chain-e2e.cjs`: a new player's deposit and withdrawal through the app.
- `node scripts/chain-e2e-donate.cjs`: a fruit delivery becoming a donation.
- `npx tsx scripts/testnet-pool.ts`: a pool payout.

**Gas:** the ops account pays for player wallets, about 0.45 test NEAR each. Top it up with `scripts/testnet-sweep.ts` from extra faucet accounts.
