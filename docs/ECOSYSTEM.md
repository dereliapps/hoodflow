# Ecosystem contribution plan

HoodFlow's useful open-source contribution is a Robinhood Chain lifecycle and execution-eligibility layer, not a copied landing page or a token announcement.

## Publish first

- Public HoodFlow repository with reproducible CI.
- Standalone, pure Virtuals lifecycle normalizer and fixtures.
- Documentation showing why bonding and graduated markets require different routes.
- A live proof page on `hoodflow.app`.

## Then approach Virtuals

1. Open a focused issue on `Virtual-Protocol/vp-trade-sdk` asking for an official Robinhood Chain registry and chain enum support.
2. Link the passing adapter tests and live integration; do not ask for attention with an empty repository.
3. Offer a pull request once maintainers confirm the canonical router, spender, ABI, and API chain identifiers.
4. Submit a showcase contribution only if HoodFlow adds a real ACP-compatible skill or agent workflow; do not mislabel a web interface as an ACP demo.

## Evidence maintainers can review

- Exact contract addresses and Blockscout proof links.
- Lifecycle fixtures for prototypes and graduated tokens.
- Failure cases: zero address, zero reserves, unsupported chain, stale provider, and fee-on-transfer sizing.
- A compact architecture document and threat model.

This sequence gives maintainers something technically useful to evaluate and avoids claiming an official partnership.
