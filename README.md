# HoodFlow

HoodFlow is a non-custodial automation engine and strategy marketplace concept for Robinhood Chain. Users keep assets in their wallets while each strategy enforces an asset pair, exact tranche, lifetime budget, interval, expiry and slippage ceiling onchain.

## Current status

- Product UI, browser-wallet connection, shadow strategies and permission controls are implemented.
- `HoodFlowDCA` and the bounded Uniswap adapters have 25 passing safety tests.
- All 20 canonical stock tokens and 5 ETFs, plus 8 protocol contracts, are checked read-only (34 bytecode targets including USDG).
- At the latest verification snapshot, 14 assets returned a V4 quote; 13 completed a full-input mainnet-fork swap through the official Universal Router and Permit2. MSFT remains watch-only because its quoted pool partially filled and the adapter correctly rejected the residual input.
- A full-engine AAPL/USDG fork canary completed two capped executions, blocked an early replay, finished its exact lifetime budget, and left zero protocol custody or residual allowances.
- No mainnet transaction has been broadcast. Mainnet remains locked pending a monitored canary and independent audit.

## Safety model

- The engine starts paused and cannot unpause without an adapter, keeper and at least two allowed tokens.
- Keepers cannot change the strategy assets, tranche, budget, interval or slippage.
- Stale or invalid oracle data, sequencer downtime/recovery and a stock token's own oracle pause block execution before funds move.
- The keeper prices every reviewed V4 pool configuration and chooses the highest-output route; it skips execution when none quotes successfully.
- The V4 adapter constructs a fixed three-action plan and accepts only hookless direct pools with reviewed fee/tick combinations.
- ERC-20 and Permit2 allowances are exact and reset to zero after every successful swap.
- The guardian can pause immediately; only the owner can restart execution.

## Commands

```bash
npm install
npm run dev
npm test
npm run contracts:compile
npm run infra:verify:mainnet
npm run infra:verify:fork
npm run infra:verify:canary
npm run keeper:dry-run
npm run launch:preflight
```

`infra:verify:mainnet` performs read-only RPC checks. `infra:verify:fork` executes the reviewed routes, while `infra:verify:canary` runs the complete engine twice with a 2 USDG lifetime cap. Both use a deterministic local Robinhood mainnet fork and never broadcast to the real chain. Route availability is dynamic and must be rechecked before deployment.

## Mainnet launch gates

The remaining release gates are a capped, monitored canary with production-grade RPC/oracle inputs and an independent smart-contract audit followed by timelocked multisig ownership. Do not place a funded private key in this repository.
