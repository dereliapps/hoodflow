# HoodFlow independent security review brief

Status: ready for auditor scoping, not independently audited.

HoodFlow is a self-custody execution interface and recurring swap engine on Robinhood Chain (chain ID 4663). This document is a request-for-quote brief, not an audit report or security claim.

## Review objectives

1. Prove that a keeper, owner, guardian or malicious token cannot spend beyond a user's active strategy limits.
2. Review oracle freshness, pause checks, decimals, sequencer handling and price-derived minimum output logic.
3. Review V3 and V4 adapter route validation, temporary allowances, Universal Router calldata and output accounting.
4. Review strategy lifecycle, replay/catch-up behavior, expiry, cancellation, pause authority and emergency recovery.
5. Review direct Buy/Sell Permit2 construction in the interface for exact amount, spender, nonce and deadline safety.
6. Identify centralization, upgrade, fee, deployment and keeper risks that must be disclosed or removed.

## In-scope code

- `contracts/HoodFlowDCA.sol`
- `contracts/UniswapV3DirectAdapter.sol`
- `contracts/UniswapV4DirectAdapter.sol`
- `contracts/FixedUsdFeed.sol`
- `contracts/HoodFlowMainnetBootstrap.sol`
- `contracts/interfaces/`
- deployment and verification logic under `scripts/`
- keeper transaction construction under `keeper/`
- Permit2 and Universal Router transaction construction in `app/page.tsx`, `app/community-tokens.tsx` and `lib/hoodflow-mainnet.ts`

Mocks are in scope only as supporting test infrastructure. Third-party protocol implementations are out of scope, but HoodFlow's assumptions and integrations with them are in scope.

## Current deployment

- Network: Robinhood Chain mainnet, chain ID 4663
- DCA engine: `0x234beb689a3e5d7E930D6aBBEaD6B39e47FEdc98`
- V4 adapter: `0xaBbd097b42EAEBF0B06F0Dc0eef631BFb7cf97aC`
- USDG feed: `0xFd65E40bD3A52f3D3A269bEd1eF0F80d29f858c1`
- Universal Router: `0x8876789976decbfcbbbe364623c63652db8c0904`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

The current engine owner is a single externally owned wallet. A verified multisig and timelock migration is a required remediation target, not an existing security control.

## Existing evidence

- `npm run test:contracts`: 27 engine, oracle and adapter tests
- `npm run test:release`: release configuration, price parsing and router calldata checks
- `npm run infra:verify:mainnet`: canonical contracts, tokens and feeds
- `npm run infra:verify:fork`: full-input V4 route simulations
- `npm run infra:verify:direct-buy`: direct Buy route simulations
- `npm run infra:verify:canary`: capped recurring execution and replay checks
- GitHub CodeQL workflow for JavaScript/TypeScript regressions

Automated checks are supporting evidence and do not replace manual review.

## Expected deliverables

- threat model and trust assumptions;
- severity-ranked findings with proof of concept;
- review of tests and missing invariant/fuzz coverage;
- remediation review against a frozen commit;
- final public report naming the reviewed commit, contracts and deployment addresses;
- explicit list of unresolved risks.

## Disclosure and contact

Use the repository security policy for private intake. Do not publish an unpatched vulnerability or test with third-party funds.
