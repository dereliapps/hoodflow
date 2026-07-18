# HoodFlow × Virtuals review brief

HoodFlow is a self-custody market and execution interface for Robinhood Chain. Its Virtuals integration is live at [hoodflow.app](https://hoodflow.app/?view=community) and is intentionally split into two lifecycle states.

## What is live

1. Query the official Virtuals API with the `ROBINHOOD` chain filter.
2. Index names, symbols, contracts, images, volume, holders, bonded VIRTUAL, FDV, and official market links.
3. Treat `preToken` as active while a launch is bonding.
4. Switch to the graduated `tokenAddress` before probing DEX liquidity.
5. Compare executable Uniswap V2, V3, and V4 routes.
6. Let a wallet pay or receive USDG, VIRTUAL, or WETH with a bounded minimum output.

The adapter is implemented in [`lib/launchpads/virtuals.ts`](../lib/launchpads/virtuals.ts). Lifecycle fixtures live in [`tests/virtuals-market.test.ts`](../tests/virtuals-market.test.ts), and mixed settlement calldata is covered by [`tests/router-calldata.test.ts`](../tests/router-calldata.test.ts).

## Reproducible route proof

[`virtuals-karma-route-4663.json`](proofs/virtuals-karma-route-4663.json) records a block-pinned mainnet quote for:

```text
10 USDG → VIRTUAL → KARMA
Robinhood Chain / chain ID 4663
Uniswap V2 / two pools / one Universal Router execution path
```

The proof contains the exact block, contracts, pools, reserves, path, and raw integer output. It is evidence of route discovery, not a guaranteed future price. HoodFlow re-quotes before every wallet signature.

## Safety boundary

Bonding-curve writes are not inferred from explorer traces or Base-only SDK constants. HoodFlow links bonding users to the official Virtuals market and enables embedded execution only after graduated DEX liquidity can be verified.

## Questions for Virtuals maintainers

HoodFlow can add a reviewed Robinhood Chain bonding adapter after the following are published or confirmed:

- canonical BondingV5 proxy and implementation addresses;
- allowance spender and router addresses for buy and sell;
- quote, fee, buy, sell, lifecycle, pause, and graduation ABIs;
- fee-on-transfer settlement rules;
- supported minimum-output semantics;
- builder attribution or fee requirements.

Feedback can be filed through the repository issue tracker. No private keys, wallet material, or privileged RPC credentials are required to review the read adapter and proof fixtures.
