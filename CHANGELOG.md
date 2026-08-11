# Changelog

## 0.16.0 — 2026-08-11

- Added BellLock, a buy-only passive reopening-policy workspace with hard gap, spread, oracle/DEX and stress-size boundaries.
- Added a trusted-server BellProof evaluator that requires verifier-bound closed-to-open session reports, two distinct price reports, previous-close binding and exact plus stress route evidence.
- Added a public fail-closed BellLock preview endpoint that rejects caller-supplied evidence and can never return a trade handoff without signed session verification.
- Added source-observed RefusalProof receipts, device-local policy history, OpenAPI/agent-manifest discovery and full BellLock documentation.
- Kept wallet approval, signing, custody and transaction submission outside the BellLock observer.

## 0.7.0 — 2026-07-18

- Added selectable USDG, VIRTUAL, and WETH payment assets to the community-token terminal.
- Added atomic two-pool V2 routing through a market's native quote token, including USDG → VIRTUAL → graduated Virtuals tokens.
- Added wallet balance visibility and explicit multi-pool execution labels.
- Added durable referral-link creation, live verified standings, wallet rank, and referral counts.
- Reworked swap and rewards copy to be shorter and more direct.

## 0.6.0 — 2026-07-18

- Added the official Virtuals Robinhood Chain discovery feed.
- Added general bonding-versus-graduated lifecycle normalization.
- Prevented zero-address and empty launchpad pairs from being treated as executable DEX settlement routes.
- Added Virtuals Agents category, lifecycle badges, official market links, bonded VIRTUAL, holders, and VIRTUAL-denominated FDV.
- Added public-repository documentation, CI, contribution rules, security templates, and adapter tests.

## 0.5.2 — 2026-07-18

- Added community-token discovery and contract-address lookup.
- Added V2, V3, and V4 route probing for community markets.
- Added category, volume, gainer, loser, liquidity, and new-pool views.

Earlier versions were private product-development snapshots.
