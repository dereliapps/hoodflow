# HoodFlow

HoodFlow is a non-custodial automation engine and strategy marketplace concept for Robinhood Chain. Users keep assets in their wallets while each strategy enforces an asset pair, exact tranche, lifetime budget, interval, expiry and slippage ceiling onchain.

## Current status

- Product UI connects injected browser wallets or WalletConnect QR/mobile sessions to Robinhood Chain mainnet, reads ETH/USDG balances, and enables user-signed direct USDG buys for 15 full-fill verified assets. WalletConnect is enabled at runtime with `WALLETCONNECT_PROJECT_ID`.
- The asset matrix reads multiplier-adjusted token prices from 24 current Chainlink feeds on Robinhood Chain, refreshes every 30 seconds, and visibly guards stale or paused values. BE remains explicit as unavailable because the current Chainlink Robinhood registry does not list a BE feed.
- `HoodFlowDCA` and the bounded Uniswap adapters have 25 passing safety tests.
- All 20 canonical stock tokens and 5 ETFs, plus 10 protocol contracts, are checked read-only (36 bytecode targets including USDG).
- At the latest verification snapshot, 15 assets returned a verified V3 or V4 quote and all 15 completed a protected full-input mainnet-fork swap through the official Universal Router and Permit2. SGOV and SLV use verified V3 pools; the other 13 use reviewed V4 pools. MSFT remains watch-only because its deterministic-fork route partially filled and the adapter correctly rejected the residual input; current-head quote availability may change between scans.
- The exact frontend INTC flow was executed on a local Robinhood mainnet fork: live best-of-three quote, exact ERC-20 approval, short-lived Permit2 signature, Universal Router execution, direct wallet receipt, and zero remaining order allowances.
- A full-engine AAPL/USDG fork canary completed two capped executions, blocked an early replay, finished its exact lifetime budget, and left zero protocol custody or residual allowances.
- Direct buys do not depend on a HoodFlow deployment: the user signs the canonical Universal Router transaction and receives the stock token directly. Recurring DCA remains disabled until a HoodFlow engine address, bytecode, configuration, keeper and unpaused state are verified.

## Safety model

- The engine starts paused and cannot unpause without an adapter, keeper and at least two allowed tokens.
- Keepers cannot change the strategy assets, tranche, budget, interval or slippage.
- Stale or invalid oracle data, sequencer downtime/recovery and a stock token's own oracle pause block execution before funds move.
- Displayed prices are informational onchain token prices, not DEX execution quotes or headline share prices; Robinhood's corporate-action multiplier is already included.
- The keeper prices every reviewed V4 pool configuration and chooses the highest-output route; it skips execution when none quotes successfully.
- The V4 adapter constructs a fixed three-action plan and accepts only hookless direct pools with reviewed fee/tick combinations.
- A fresh direct buy approves only the order amount to Permit2 and the signed router allowance is short-lived and exact. Both are consumed by the verified flow; an already-existing wallet-level Permit2 token approval is never silently increased.
- The guardian can pause immediately; only the owner can restart execution.

## Commands

```bash
npm install
npm run dev
npm test
npm run contracts:compile
npm run infra:verify:mainnet
npm run infra:verify:fork
npm run infra:verify:direct-buy
npm run infra:verify:canary
npm run keeper:dry-run
npm run launch:preflight
npm run mainnet:preflight
npm run mainnet:verify:deployment
```

`infra:verify:mainnet` performs read-only RPC checks. `infra:verify:fork` executes the 13 reviewed V4 routes, `infra:verify:direct-buy` runs the exact user-facing INTC V4 plus SGOV/SLV V3 Permit2 flows, and `infra:verify:canary` runs the complete engine twice with a 2 USDG lifetime cap. They use a deterministic local Robinhood mainnet fork and never broadcast to the real chain. Route availability is dynamic and is quoted again before every user order.

## Mainnet launch gates

`mainnet:preflight` is a fail-closed, read-only release check. It requires two independent production RPCs, separated roles, official Uniswap addresses, canonical token/oracle policies, a pinned source commit, independent audit evidence, a confirmed funded testnet canary and a completed monitoring/pause drill. It rejects a funded mainnet key and never broadcasts.

After a separately reviewed paused deployment, `mainnet:verify:deployment` checks ownership acceptance, exact configuration, adapter wiring, pause state, zero custody and zero ERC-20/Permit2 allowances. The full ceremony and incident procedure are in [MAINNET_RUNBOOK.md](MAINNET_RUNBOOK.md).

The remaining external gates are a capped, monitored public-network canary with production-grade RPC/oracle inputs and an independent smart-contract audit followed by timelocked multisig ownership. Do not place a funded private key in this repository.
