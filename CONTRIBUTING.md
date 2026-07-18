# Contributing to HoodFlow

HoodFlow accepts focused, testable changes. Useful contributions include launchpad lifecycle adapters, reproducible route fixtures, provider-failure handling, accessibility, documentation, and security hardening.

## Before opening a pull request

1. Open an issue for changes that add a transaction target, approval spender, router, or new chain.
2. Base contract addresses on an official registry or verified source. Explorer labels and observed calldata are research evidence, not sufficient authority for wallet writes.
3. Keep private keys, seed phrases, API secrets, funded-wallet data, and personal information out of code, fixtures, screenshots, logs, commits, and issue bodies.
4. Run:

```bash
npm ci
npm run lint
npm test
```

## Launchpad adapter rules

- Read integrations and transaction integrations are reviewed separately.
- Every adapter must expose a lifecycle state and fail closed on unknown states.
- A pre-created or zero-reserve pair must not be described as executable liquidity.
- Fee-on-transfer behavior must be tested before a write adapter can be enabled.
- External launchpad links must point to the official market record for the token.

## Pull request checklist

- Explain the user-facing problem and the trust boundary changed.
- Add or update tests.
- Document new environment variables and external data sources.
- Include proof links for onchain addresses.
- Do not describe unaudited code as audited, verified, safe, or officially endorsed.

By contributing, you agree that your contribution is licensed under the MIT License.
