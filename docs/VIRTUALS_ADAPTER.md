# Virtuals Robinhood Chain adapter

## Problem

Virtuals prototypes trade on a bonding system before graduation. A prototype may already expose a pair address, while the conventional DEX pair has no executable reserves. Generic pair discovery therefore cannot decide how the token trades.

## Current read integration

HoodFlow queries the official Virtuals API with a fixed `ROBINHOOD` chain filter and normalizes each record into one of two states:

- `bonding` — `preToken` is the active token and HoodFlow links to the official Virtuals market.
- `graduated` — `tokenAddress` is active and HoodFlow may probe post-graduation DEX liquidity.

The adapter also exposes the official market URL, holder count, bonded VIRTUAL, 24-hour volume, price change, liquidity, launch time, and VIRTUAL-denominated FDV when supplied.

## Why writes are not enabled yet

The official `vp-trade-sdk` currently publishes Base and Solana chain constants; it does not expose Robinhood Chain transaction constants. The separate `bondv5-trader` repository is also explicitly Base-only. Robinhood Chain trades observed in the explorer call upgradeable proxy routers whose implementation and spender policy are not a safe substitute for an official integration contract.

Before enabling in-HoodFlow bonding buys and sells, the adapter needs:

1. Official Robinhood Chain BondingV5 proxy and implementation addresses.
2. The actual ERC-20 allowance spender for every trade path.
3. Verified buy, sell, quote, lifecycle, and fee ABIs.
4. Fee-on-transfer balance reconciliation.
5. A production-safe minimum-output quote, never `minOut = 1`.
6. Fork or capped public-network tests covering buy, sell, graduation, pause, and proxy upgrade behavior.
7. A documented builder-fee arrangement, if applicable.

Until those requirements are met, HoodFlow fails closed and directs bonding users to the official Virtuals market.

## Adding another launchpad

New adapters should follow the same boundary: source-specific read normalization first, then an independently reviewed write adapter. See [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
