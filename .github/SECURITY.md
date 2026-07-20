# HoodFlow security policy

HoodFlow is a Mainnet Beta interface. The contracts and interface have not yet completed an independent audit. Public source, automated tests and static analysis are useful evidence, but they are not substitutes for an independent security review.

## Report a vulnerability privately

Use [GitHub Private Vulnerability Reporting](https://github.com/dereliapps/hoodflow/security/advisories/new) when the private report form is available. If GitHub does not show that form, contact the [official HoodFlow X account](https://x.com/hoodfloow) to establish a private reporting channel. Do not post an unpatched vulnerability in a public issue or public reply.

Include:

- the affected contract, function, route or interface flow;
- the impact and the conditions required to reproduce it;
- a minimal proof of concept that does not move third-party funds;
- recommended remediation, when available.

We aim to acknowledge a complete report within 72 hours. Acknowledgement is not confirmation of severity.

## In scope

- `HoodFlowDCA.sol` and HoodFlow-owned swap adapters;
- transaction construction, permission scope and slippage protection in the interface;
- route validation, oracle checks and pause behavior;
- vulnerabilities that can cause loss of funds, unauthorized execution, bypassed limits or material denial of service.

## Out of scope

- vulnerabilities in Robinhood Chain, wallets, token issuers, Uniswap, Permit2, RPC providers or other third-party systems;
- market manipulation claims without a reproducible HoodFlow-specific exploit;
- denial-of-service traffic, spam, phishing, social engineering or attacks on users;
- testing against accounts or funds you do not own.

## Rewards and safe testing

HoodFlow does not currently promise a monetary reward. A funded public bug bounty will be announced separately if one is created. Researchers must use their own accounts and funds, avoid privacy violations and stop immediately if testing could affect another user.
