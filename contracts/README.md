# HoodFlow protocol core

`HoodFlowDCA` is an allowance-based recurring swap engine. It never asks users to deposit an open-ended balance into a protocol vault. Each execution can pull only the configured tranche, and the cumulative `remainingBudget` is enforced onchain.

## Enforced invariants

- Only allowlisted canonical ERC-20 assets can be used.
- Every strategy has an exact tranche, total budget, interval, expiry and maximum slippage.
- A keeper cannot execute early, execute twice in a catch-up burst, or exceed the total budget.
- Both input and output Chainlink-compatible feeds must be positive, complete and inside their heartbeat.
- The adapter receives an exact, temporary allowance that is reset to zero after use.
- Output is measured from the user's real token balance; an adapter return value is not trusted.
- A guardian can pause immediately, but only the owner can restart execution.
- Adapter, token, keeper and fee changes are possible only while the protocol is paused.

## Mainnet blockers

This code is a testnet candidate, not audited production software. Before mainnet it still needs an independent audit, a timelocked multisig owner, a reviewed chain-specific swap adapter, canonical token/feed addresses, production monitoring, incident drills and a capped canary launch.

Never place a funded private key in this repository. Copy `.env.example` to an ignored `.env` only on the deployment or keeper host, and use a dedicated low-balance testnet wallet.
