# HoodFlow architecture

## Trust boundaries

HoodFlow separates market discovery, lifecycle classification, executable quoting, and wallet signing. A provider response can make a market visible, but it cannot by itself make a transaction button executable.

```text
public metadata providers
        │
        ▼
normalization + deduplication
        │
        ├── canonical Stock Token registry
        ├── launchpad lifecycle adapter
        └── unreviewed community token
        │
        ▼
execution eligibility gate
        │
        ├── bonding/unknown ──> source-market link only
        └── DEX liquidity ───> fresh V2/V3/V4 quote
                                  │
                                  ▼
                         exact wallet permission
                                  │
                                  ▼
                        self-custody settlement
```

## Discovery layer

- Virtuals API supplies official Robinhood Chain launch records and lifecycle fields.
- GeckoTerminal supplies top-volume, trending, and new pools.
- DEX Screener supplies canonical-token and contract-address pair data.
- HoodFlow deduplicates by token contract, never by symbol.

Provider ranking is discovery data, not a HoodFlow endorsement. Categories inferred from names and symbols can be wrong; canonical RWA and Virtuals classifications come from dedicated sources.

## Execution layer

The client reads the token contract directly, then probes onchain liquidity. A quote is short-lived and recomputed immediately before signing. The user sets slippage, and the calldata includes a minimum output. Settlement goes directly to the connected wallet.

Launchpad bonding transactions are not enabled merely because observed trades reveal a proxy address. A write adapter requires an official contract registry, verified ABI, allowance-spender mapping, fee-on-transfer tests, and fork or capped public-network evidence.

## Recurring engine

The DCA contracts are a separate pre-audit system. Their deployment state does not affect direct swaps. See [`../SECURITY.md`](../SECURITY.md) and [`../MAINNET_RUNBOOK.md`](../MAINNET_RUNBOOK.md).
