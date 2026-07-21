# HoodFlow security and launch policy

HoodFlow's recurring contracts are pre-audit. Do not treat a passing local build, RPC scan, fork simulation, provider label, or public transaction as an audit.

## Reporting a vulnerability

After the public repository is available, use GitHub's private vulnerability-reporting flow under the repository's **Security** tab. Do not open a public issue for an exploitable finding. Include affected commit, impact, reproduction, and a proposed mitigation if known. Never include private keys, seed phrases, RPC secrets, funded-wallet details, or unrelated personal data.

## Security boundaries

- Direct swaps are signed by the user and settle to the connected wallet; market-data visibility does not automatically enable execution.
- Launchpad bonding, graduated DEX liquidity, and unknown lifecycle states are distinct. Unknown and bonding states fail closed for embedded execution.
- A launchpad write adapter requires an official registry, verified ABI and spender, fee-on-transfer tests, and protected minimum-output quotes.
- Users retain custody; the engine pulls only the exact configured tranche through ERC-20 allowance.
- Every strategy fixes its token pair, tranche, lifetime budget, interval, expiry, and maximum slippage.
- Keepers may choose only one of three reviewed, hookless Uniswap V4 pool configurations.
- Onchain oracle checks, sequencer status/recovery, stock-token oracle pause, and measured recipient output fail closed.
- Engine-to-adapter, adapter-to-Permit2, and Permit2-to-router allowances are cleared after execution.
- A guardian can pause immediately. Only the owner can restart execution or change critical configuration.

## Beta exit gates

1. `npm run launch:preflight` passes against the intended release commit.
2. Every production address and oracle feed is independently checked against an official primary source.
3. Deployment starts paused; ownership is accepted by a timelocked multisig before unpausing.
4. A capped canary uses a dedicated wallet, one allowlisted asset, a 1 USDG tranche, and a 2 USDG lifetime budget.
5. Canary monitoring confirms execution, replay protection, zero protocol custody, zero residual allowances, and working emergency pause.
6. An independent smart-contract audit is complete and all critical/high findings are resolved.
7. Incident response, RPC failover, keeper alerting, and emergency-pause drills are documented and tested.

## Known launch blockers

- No independent audit has been completed.
- Production Chainlink feed addresses and heartbeat policies must be reviewed immediately before deployment.
- A funded public-network canary has not been executed.
- The public Robinhood RPC is rate-limited and is not suitable as the sole production provider.
- No independent audit covers the community-token V2/V3/V4 execution surface.
- The official Virtuals SDK does not currently publish Robinhood Chain write constants; bonding trades therefore remain external.

Security acknowledgements are published only with the reporter's permission.
