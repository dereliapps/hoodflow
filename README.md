# HoodFlow

HoodFlow is a non-custodial automation engine and strategy marketplace concept for Robinhood Chain. Users keep assets in their wallets while each strategy enforces an asset pair, exact tranche, lifetime budget, interval, expiry and slippage ceiling onchain.

## Current status

- Product UI, browser-wallet connection, shadow strategies and permission controls are implemented.
- `HoodFlowDCA` and the bounded Uniswap adapters have 23 passing safety tests.
- Official Robinhood mainnet tokens and Uniswap infrastructure are checked read-only.
- The V4 adapter completed AAPL/USDG, NVDA/USDG, GOOGL/USDG and TSLA/USDG swaps on a local mainnet fork through the official Universal Router and Permit2.
- No mainnet transaction has been broadcast. Mainnet remains locked pending a monitored canary and independent audit.

## Safety model

- The engine starts paused and cannot unpause without an adapter, keeper and at least two allowed tokens.
- Keepers cannot change the strategy assets, tranche, budget, interval or slippage.
- Stale or invalid oracle data blocks execution before funds move.
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
npm run keeper:dry-run
```

`infra:verify:mainnet` performs read-only RPC checks. `infra:verify:fork` creates a local Robinhood mainnet fork and executes the four reviewed routes without broadcasting to the real chain.

## Mainnet launch gates

The remaining release gates are a capped, monitored canary with production-grade RPC/oracle inputs and an independent smart-contract audit followed by timelocked multisig ownership. Do not place a funded private key in this repository.
