# HoodFlow protocol core

`HoodFlowDCA` is an allowance-based recurring swap engine. It never asks users to deposit an open-ended balance into a protocol vault. Each execution can pull only the configured tranche, and the cumulative `remainingBudget` is enforced onchain.

## Enforced invariants

- Only allowlisted canonical ERC-20 assets can be used.
- Every strategy has an exact tranche, total budget, interval, expiry and maximum slippage.
- A keeper cannot execute early, execute twice in a catch-up burst, or exceed the total budget.
- Both input and output Chainlink-compatible feeds must be positive, complete and inside their heartbeat.
- Sequencer downtime and the configured recovery grace period block all quoting and execution.
- Canonical stock tokens configured for pause checks must report `oraclePaused() == false`.
- The adapter receives an exact, temporary allowance that is reset to zero after use.
- The production-candidate V4 adapter constructs the Universal Router action plan internally and permits only one hookless direct pool hop.
- V4 pools are limited to the reviewed 0.05%, 0.30% and 1.00% fee/tick-spacing combinations.
- Output is measured from the user's real token balance; an adapter return value is not trusted.
- A guardian can pause immediately, but only the owner can restart execution.
- Adapter, token, keeper and fee changes are possible only while the protocol is paused.

## Verification evidence

- 25 local engine, oracle and adapter scenarios pass.
- All 25 canonical Robinhood stock/ETF tokens, USDG and 8 protocol contracts are checked by `npm run infra:verify:mainnet`.
- The 13 routes available at the latest snapshot execute through the official V4 Universal Router on a local fork via `npm run infra:verify:fork`.
- The fork verification performs no real-chain broadcast.

## Mainnet blockers

This code is a testnet candidate, not audited production software. Before mainnet it still needs an independent audit, a timelocked multisig owner, canonical production feed addresses, production-grade RPC and monitoring, incident drills and a capped canary launch.

Never place a funded private key in this repository. Copy `.env.example` to an ignored `.env` only on the deployment or keeper host, and use a dedicated low-balance testnet wallet.
