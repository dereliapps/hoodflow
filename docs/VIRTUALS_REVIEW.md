# HoodFlow × Virtuals review brief

HoodFlow is a self-custody market and execution interface for Robinhood Chain. Its Virtuals integration is live at [hoodflow.app](https://hoodflow.app/?view=community) and is intentionally split into two lifecycle states.

## Public Agent API

HoodFlow also exposes a bounded, read-only agent surface:

- [Capability and safety manifest](https://hoodflow.app/api/agents/hoodflow)
- [Route-reviewed Stock Token markets](https://hoodflow.app/api/agents/markets)
- `POST https://hoodflow.app/api/agents/quote` for a short-lived indicative preflight
- [Interactive agent workspace](https://hoodflow.app/?view=agents)

The quote endpoint validates the market, finds a reviewed Uniswap V3 or V4 route, checks a live oracle reference and maximum deviation, computes an indicative minimum output, and returns a 75-second handoff. It cannot connect a wallet, approve tokens, sign, or submit a transaction. HoodFlow requotes the intent before the user's wallet confirms it.

This is an API-only provider candidate. It is not a published Virtuals ACP resource, an ACP job flow, or an EconomyOS Agent Wallet integration.

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

## Completed user-signed execution proof

On 2026-07-22, a user wallet completed a HoodFlow mainnet trade after an Agent API preflight:

- Input: `1.0 USDG`
- Output: `0.00937386626109376 INTC`
- Robinhood Chain block: `16478330`
- [Transaction receipt](https://robinhoodchain.blockscout.com/tx/0x7c9d4dcea9c32b5df03283b010617084499d5ab29ca8a093c9f49a6e5c2303c3)
- [Decoded proof](proofs/executed-intc-buy-4663.json)

The receipt independently proves the wallet/token trade. The preceding offchain preflight is builder-attested and is not cryptographically bound to the transaction. The agent did not sign or submit the trade, and this proof is not represented as an ACP job.

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
