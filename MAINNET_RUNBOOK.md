# HoodFlow Mainnet Runbook

This runbook is intentionally fail-closed. Passing local tests does not authorize a deployment, and deployment does not authorize unpausing.

## 1. Freeze the candidate

1. Create a release commit with a clean worktree.
2. Record the full 40-character commit in `HOODFLOW_SOURCE_COMMIT`.
3. Run `npm ci`, `npm run lint`, `npx tsc --noEmit` and `npm run launch:preflight` from that exact commit.
4. Do not change contracts, dependencies, routing rules or deployment configuration after the audit begins. Any material change reopens audit review.

## 2. Close external gates

- Obtain an independent audit of `HoodFlowDCA` and `UniswapV4DirectAdapter`. Resolve every critical/high finding and get written closure for accepted lower-severity findings.
- Record the auditor name, final report SHA-256 and `HOODFLOW_AUDIT_STATUS=passed`.
- Deploy a candidate to Robinhood Chain Testnet. Run a funded canary with a 1 USDG tranche and 2 USDG lifetime cap. Confirm two executions, early-replay rejection, completed status, zero engine/adapter custody and zero residual ERC-20/Permit2 allowances.
- Record the successful receipt as `HOODFLOW_CANARY_TX_HASH` and set `HOODFLOW_CANARY_STATUS=passed` only after manual receipt review.
- Fetch every price feed address and heartbeat from Chainlink's current Robinhood feed registry. Do not copy feed addresses from old notes or this repository.

## 3. Prepare production operations

- Use two independent paid RPC providers. The public Robinhood RPC is rate-limited and must not be the only production dependency.
- Set final owner to a deployed timelocked multisig. Keep guardian, fee recipient and keeper roles distinct.
- Configure at least two release approvers in `HOODFLOW_RELEASE_APPROVERS`.
- Wire alerts for RPC disagreement, keeper balance, missed execution, failed preflight, stale feed, sequencer outage, contract pause and unexpected token/allowance balances.
- Run a pause drill: guardian pauses, monitoring fires, keeper stops, owner reviews, and only the timelocked multisig can resume. Then set `HOODFLOW_INCIDENT_DRILL_STATUS=passed` and `HOODFLOW_MONITORING_READY=true`.

## 4. Run the release gate

Keep all production secrets outside the repository. The gate itself rejects funded mainnet private keys.

```bash
npm run mainnet:preflight
```

The command validates the network, independent RPCs, separated roles, official Uniswap addresses, canonical assets, oracle policies, audit/canary evidence, operations evidence and source commit. It then checks chain IDs, RPC head agreement, bytecode agreement through both providers and the canary receipt. Every line must report `PASS`.

## 5. Deploy paused

Deployment is a separate, two-person ceremony after the release gate passes. Use the reviewed build artifacts from the frozen commit and a hardware-backed signer or approved deployment service. Never paste or persist a funded private key in `.env`, shell history, this repository or a ticket.

Required order:

1. Deploy `HoodFlowDCA` with the ceremony deployer as temporary owner and a zero adapter. The constructor pauses it.
2. Deploy `UniswapV4DirectAdapter` bound to the engine, official Universal Router and Permit2.
3. Configure adapter, sequencer feed, keepers and reviewed token/feed/heartbeat policies while paused.
4. Transfer ownership with `Ownable2Step`; the final timelocked multisig must call `acceptOwnership`.
5. Do not call `unpauseEverything` during deployment.

## 6. Verify the deployed state

Set `HOODFLOW_CONTRACT_ADDRESS` and `HOODFLOW_ADAPTER_ADDRESS`, then run:

```bash
npm run mainnet:verify:deployment
```

The verifier requires the final owner to have accepted ownership, no pending owner, a paused engine, exact role/fee/oracle/keeper/token configuration, the bounded adapter wired to official Uniswap contracts, and zero custody or residual allowances for every configured token.

Independently verify the source and constructor inputs on the Robinhood Chain explorer. Both release approvers must compare explorer state with the gate output before signing off.

## 7. Capped mainnet activation

Only after deployment verification and explorer verification:

1. Create a dedicated 1 USDG canary strategy with a 2 USDG lifetime cap.
2. Unpause through the timelocked multisig during a staffed monitoring window.
3. Execute one tranche, inspect the receipt, balances, allowances, oracle state and keeper logs.
4. Wait one full interval and execute the second tranche. Confirm completion and replay rejection.
5. Pause immediately on any mismatch. Do not expand limits for at least 24 hours of clean monitoring.

## Emergency response

1. Guardian calls `pauseEverything`.
2. Stop keeper broadcast processes; keep read-only monitoring alive.
3. Record the last known-good block and all affected strategy IDs.
4. Check engine/adapter balances and ERC-20/Permit2 allowances.
5. Publish a user-facing incident notice without promising recovery times.
6. Resume only after root-cause review, a tested remediation and timelocked multisig approval.
