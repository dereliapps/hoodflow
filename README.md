# HoodFlow

HoodFlow is an independent, self-custody execution interface for Robinhood Chain. It discovers Stock Token and community-token markets, separates launchpad bonding curves from graduated DEX liquidity, compares executable routes, and lets the connected wallet sign each transaction directly.

Live product: [hoodflow.app](https://hoodflow.app)

> Independent interface built on Robinhood Chain. Not affiliated with or endorsed by Robinhood Markets, Inc. Stock Tokens are not shares and may be restricted in your jurisdiction.

## Virtuals on Robinhood Chain

HoodFlow indexes the official Virtuals Robinhood Chain launch feed and keeps bonding markets separate from graduated DEX liquidity. Graduated tokens can be quoted through USDG, VIRTUAL, or WETH; bonding tokens remain linked to their official Virtuals market until a reviewed Robinhood Chain write adapter is available.

- [Open the live Virtuals Agents market](https://hoodflow.app/?view=community)
- [Review the integration boundary and maintainer questions](docs/VIRTUALS_REVIEW.md)
- [Inspect a block-pinned USDG → VIRTUAL → KARMA route proof](docs/proofs/virtuals-karma-route-4663.json)
- [Read the adapter implementation notes](docs/VIRTUALS_ADAPTER.md)

## What works today

- WalletConnect and injected-wallet connections to Robinhood Chain mainnet.
- Live onchain reference prices and history for the canonical Stock Token registry.
- Protected direct buy and sell routes through reviewed Uniswap V2, V3, and V4 liquidity.
- Community market discovery from GeckoTerminal and DEX Screener.
- Official Virtuals Robinhood Chain discovery with explicit `bonding` and `graduated` lifecycle states.
- Contract-address lookup, native quote-asset detection, minimum output, bounded slippage, and self-custody settlement.
- Durable referral profiles, verified first-trade points, shareable links, and a public leaderboard.
- Selectable USDG, VIRTUAL, and WETH settlement with atomic V2 routing through a market's native quote token when needed.

## Why the launchpad adapter exists

A launchpad token can have a pair address while still trading on a bonding curve. Treating that empty pair as a normal DEX market produces the misleading “no route” state that originally affected CLUSTY and other Virtuals prototypes.

HoodFlow fixes the general case:

1. Read the official Virtuals listing for Robinhood Chain.
2. Identify the token as `bonding` or `graduated`.
3. Keep bonding trades on the official Virtuals market.
4. Probe V2, V3, and V4 only after verifiable DEX liquidity exists.

The read adapter is in [`lib/launchpads/virtuals.ts`](lib/launchpads/virtuals.ts). Robinhood Chain write support is deliberately not copied from Base-only SDK constants or inferred from unverified proxy calldata.

## Architecture

```text
Virtuals API ─┐
GeckoTerminal ├─ market normalization ─ lifecycle gate ─ route probe ─ wallet signature
DEX Screener ─┘                               │
                                             └─ official launchpad link (bonding)
```

- `app/api/community-markets/route.ts` — server-side discovery and normalization.
- `lib/launchpads/virtuals.ts` — pure Virtuals lifecycle adapter.
- `app/community-tokens.tsx` — market terminal and wallet-signed execution.
- `lib/hoodflow-mainnet.ts` — canonical addresses, ABIs, and calldata builders.
- `contracts/` — bounded recurring engine and adapters; still pre-audit and gated.
- `tests/` and `test/` — application, release, adapter, and contract tests.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/VIRTUALS_ADAPTER.md`](docs/VIRTUALS_ADAPTER.md) for deeper notes.

## Local development

Requirements: Node.js 22.13+ and npm 10.9+.

```bash
npm ci
npm run dev
```

Quality gates:

```bash
npm run lint
npm test
npm run contracts:compile
```

RPC and wallet configuration is documented in [`.env.example`](.env.example). Never commit a private key, seed phrase, production RPC secret, or funded keeper credential.

## Security status

The direct swap interface is self-custodial, but the recurring contracts are pre-audit. Passing tests and fork simulations are not an audit. Known blockers and disclosure instructions are in [`SECURITY.md`](SECURITY.md).

## Contributing

Bug reports, new launchpad read adapters, route fixtures, documentation improvements, and reproducible Robinhood Chain research are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.

## License

MIT — see [`LICENSE`](LICENSE).
