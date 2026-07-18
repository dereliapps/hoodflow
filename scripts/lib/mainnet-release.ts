import { getAddress, isAddress } from "ethers";

import robinhoodMainnet from "../../config/robinhood-mainnet.json" with { type: "json" };
import { ROBINHOOD_PRICE_FEEDS } from "../../config/robinhood-price-feeds.js";

export const MAINNET_CHAIN_ID = 4_663;
export const TESTNET_CHAIN_ID = 46_630;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const PUBLIC_ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
const PLACEHOLDER_PATTERN = /YOUR_|REPLACE|PLACEHOLDER|EXAMPLE|0xDEPLOYED|0xFINAL|0xSEPARATE|0xFEE|0xKEEPER|0xCHAINLINK|0xREVIEWED/i;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
const COMMIT_PATTERN = /^[0-9a-fA-F]{40}$/;

export type TokenReleaseConfig = {
  token: string;
  feed: string;
  heartbeat: number;
  checkOraclePause: boolean;
};

export type ReleaseConfig = {
  primaryRpcUrl: string;
  secondaryRpcUrl: string;
  canaryRpcUrl: string;
  chainId: number;
  finalOwner: string;
  guardian: string;
  feeRecipient: string;
  feeBps: number;
  keepers: string[];
  releaseApprovers: string[];
  universalRouter: string;
  permit2: string;
  settlementToken: string;
  maxTrancheAmount: string;
  maxStrategyBudget: string;
  sequencerMode: string;
  sequencerFeed: string;
  sequencerGracePeriod: number;
  tokenConfigs: TokenReleaseConfig[];
  auditProvider: string;
  auditReportPath: string;
  auditReportSha256: string;
  auditStatus: string;
  canaryChainId: number;
  canaryTransactionHash: string;
  canaryStatus: string;
  monitoringReady: boolean;
  incidentDrillStatus: string;
  sourceCommit: string;
  unpauseAfterDeploy: boolean;
};

export type ReleaseGate = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ReleaseReport = {
  ready: boolean;
  passed: number;
  total: number;
  gates: ReleaseGate[];
  config: ReleaseConfig;
};

export function evaluateReleaseEnvironment(env: NodeJS.ProcessEnv): ReleaseReport {
  const config = parseReleaseConfig(env);
  const gates: ReleaseGate[] = [];
  const gate = (id: string, label: string, passed: boolean, detail: string) => {
    gates.push({ id, label, passed, detail });
  };

  gate(
    "network",
    "Robinhood mainnet selected",
    config.chainId === MAINNET_CHAIN_ID,
    config.chainId === MAINNET_CHAIN_ID
      ? `chainId ${MAINNET_CHAIN_ID}`
      : `HOODFLOW_CHAIN_ID must be ${MAINNET_CHAIN_ID}`,
  );

  const rpcUrlsValid = [config.primaryRpcUrl, config.secondaryRpcUrl]
    .every((value) => isProductionRpcUrl(value));
  const rpcHosts = [config.primaryRpcUrl, config.secondaryRpcUrl].map(urlHost);
  const rpcProvidersDistinct = rpcHosts.every(Boolean) && rpcHosts[0] !== rpcHosts[1];
  gate(
    "rpc",
    "Independent production RPCs",
    rpcUrlsValid && rpcProvidersDistinct,
    rpcUrlsValid && rpcProvidersDistinct
      ? `${rpcHosts[0]} + ${rpcHosts[1]}`
      : "Provide two HTTPS provider URLs with different hosts; the public Robinhood RPC is not production infrastructure",
  );

  const roles = [config.finalOwner, config.guardian, config.feeRecipient];
  const rolesValid = roles.every(isConfiguredAddress);
  const rolesDistinct = new Set(roles.map((address) => address.toLowerCase())).size === roles.length;
  gate(
    "roles",
    "Owner, guardian and fees separated",
    rolesValid && rolesDistinct,
    rolesValid && rolesDistinct
      ? "Three distinct configured addresses"
      : "Set three valid, distinct addresses",
  );

  const keepersValid = config.keepers.length > 0
    && config.keepers.every(isConfiguredAddress)
    && uniqueAddresses(config.keepers).length === config.keepers.length
    && config.keepers.every((keeper) => !roles.some((role) => sameAddress(keeper, role)));
  gate(
    "keepers",
    "Dedicated keeper set",
    keepersValid,
    keepersValid
      ? `${config.keepers.length} dedicated keeper${config.keepers.length === 1 ? "" : "s"}`
      : "Provide unique keeper addresses that do not overlap owner, guardian or fee recipient",
  );

  const approversValid = config.releaseApprovers.length >= 2
    && config.releaseApprovers.every(isConfiguredAddress)
    && uniqueAddresses(config.releaseApprovers).length === config.releaseApprovers.length;
  gate(
    "approval",
    "Two-person release approval",
    approversValid,
    approversValid
      ? `${config.releaseApprovers.length} distinct release approvers`
      : "HOODFLOW_RELEASE_APPROVERS must contain at least two distinct addresses",
  );

  const officialRouter = robinhoodMainnet.contracts.universalRouter;
  const officialPermit2 = robinhoodMainnet.contracts.permit2;
  const dexAddressesValid = sameAddress(config.universalRouter, officialRouter)
    && sameAddress(config.permit2, officialPermit2);
  gate(
    "dex",
    "Official Uniswap contracts",
    dexAddressesValid,
    dexAddressesValid
      ? "Universal Router and Permit2 match the reviewed Robinhood deployment"
      : `Expected router ${officialRouter} and Permit2 ${officialPermit2}`,
  );

  const capsValid = sameAddress(config.settlementToken, robinhoodMainnet.tokens.USDG)
    && positiveUint128(config.maxTrancheAmount)
    && positiveUint128(config.maxStrategyBudget)
    && BigInt(config.maxStrategyBudget) >= BigInt(config.maxTrancheAmount);
  gate(
    "limits",
    "Canonical USDG and execution caps",
    capsValid,
    capsValid
      ? `tranche ${config.maxTrancheAmount}; lifetime ${config.maxStrategyBudget} atomic USDG`
      : "Use canonical USDG and positive uint128 caps with lifetime cap at least the tranche cap",
  );

  const oracleConfigValid = config.sequencerMode === "none"
    ? sameAddress(config.sequencerFeed, ZERO_ADDRESS) && config.sequencerGracePeriod === 0
    : config.sequencerMode === "chainlink"
      && isConfiguredAddress(config.sequencerFeed)
      && config.sequencerGracePeriod >= 300
      && config.sequencerGracePeriod <= 86_400;
  gate(
    "sequencer",
    "Sequencer safety configured",
    oracleConfigValid,
    oracleConfigValid
      ? config.sequencerMode === "none"
        ? "Explicitly disabled; no published onchain feed configured"
        : `${config.sequencerGracePeriod}s recovery grace period`
      : "Set explicit mode none with zero feed/grace, or a Chainlink feed with a 300-86400 second grace period",
  );

  const canonicalTokens = Object.values(robinhoodMainnet.tokens).map((address) => address.toLowerCase());
  const usdG = robinhoodMainnet.tokens.USDG.toLowerCase();
  const tickerByToken = new Map(Object.entries(robinhoodMainnet.tokens)
    .map(([ticker, address]) => [address.toLowerCase(), ticker]));
  const tokenConfigsValid = config.tokenConfigs.length >= 2
    && uniqueAddresses(config.tokenConfigs.map((item) => item.token)).length === config.tokenConfigs.length
    && config.tokenConfigs.every((item) => {
      const token = item.token.toLowerCase();
      const ticker = tickerByToken.get(token);
      const officialFeed = ticker && ticker !== "USDG"
        ? ROBINHOOD_PRICE_FEEDS[ticker as keyof typeof ROBINHOOD_PRICE_FEEDS]
        : null;
      return canonicalTokens.includes(token)
        && isConfiguredAddress(item.feed)
        && Number.isInteger(item.heartbeat)
        && item.heartbeat >= 60
        && item.heartbeat <= 604_800
        && (token === usdG || (
          item.checkOraclePause
          && officialFeed?.feed
          && sameAddress(item.feed, officialFeed.feed)
          && item.heartbeat === officialFeed.heartbeat
        ));
    });
  const hasUsdG = config.tokenConfigs.some((item) => item.token.toLowerCase() === usdG);
  const hasStockToken = config.tokenConfigs.some((item) => item.token.toLowerCase() !== usdG);
  gate(
    "oracles",
    "Canonical token oracle policy",
    tokenConfigsValid && hasUsdG && hasStockToken,
    tokenConfigsValid && hasUsdG && hasStockToken
      ? `${config.tokenConfigs.length} canonical tokens; Chainlink registry and pause checks matched`
      : "Configure USDG plus a canonical stock/ETF using its current Chainlink feed, heartbeat and oracle-pause check",
  );

  const feeValid = Number.isInteger(config.feeBps) && config.feeBps >= 0 && config.feeBps <= 100;
  gate(
    "fee",
    "Protocol fee bounded",
    feeValid,
    feeValid ? `${config.feeBps} bps` : "HOODFLOW_INITIAL_FEE_BPS must be between 0 and 100",
  );

  const auditValid = config.auditStatus === "passed"
    && config.auditProvider.length >= 3
    && !PLACEHOLDER_PATTERN.test(config.auditProvider)
    && config.auditReportPath.length > 0
    && !PLACEHOLDER_PATTERN.test(config.auditReportPath)
    && SHA256_PATTERN.test(config.auditReportSha256);
  gate(
    "audit",
    "Independent audit evidence",
    auditValid,
    auditValid
      ? `${config.auditProvider}; report path and hash recorded`
      : "Record a passed independent audit, provider, report path and SHA-256 hash",
  );

  const canaryValid = config.canaryStatus === "passed"
    && config.canaryChainId === TESTNET_CHAIN_ID
    && TX_HASH_PATTERN.test(config.canaryTransactionHash)
    && isProductionRpcUrl(config.canaryRpcUrl, true);
  gate(
    "canary",
    "Funded public-network canary evidence",
    canaryValid,
    canaryValid
      ? `Robinhood testnet transaction ${shortHash(config.canaryTransactionHash)}`
      : `Record a successful capped canary receipt on chain ${TESTNET_CHAIN_ID}`,
  );

  const operationsValid = config.monitoringReady && config.incidentDrillStatus === "passed";
  gate(
    "operations",
    "Monitoring and pause drill",
    operationsValid,
    operationsValid
      ? "Monitoring acknowledged and incident drill passed"
      : "Set monitoring ready only after the pause/response drill passes",
  );

  gate(
    "source",
    "Reviewed source pinned",
    COMMIT_PATTERN.test(config.sourceCommit),
    COMMIT_PATTERN.test(config.sourceCommit)
      ? `commit ${config.sourceCommit.slice(0, 8)}`
      : "HOODFLOW_SOURCE_COMMIT must be the reviewed 40-character git commit",
  );

  const noFundedKey = !env.ROBINHOOD_MAINNET_PRIVATE_KEY?.trim()
    && !env.HOODFLOW_DEPLOYER_PRIVATE_KEY?.trim();
  const staysPaused = !config.unpauseAfterDeploy;
  gate(
    "broadcast",
    "No key and paused deployment",
    noFundedKey && staysPaused,
    noFundedKey && staysPaused
      ? "Preflight cannot sign and deployment remains paused"
      : "Remove funded keys from preflight and keep HOODFLOW_UNPAUSE_AFTER_DEPLOY=false",
  );

  const passed = gates.filter((item) => item.passed).length;
  return { ready: passed === gates.length, passed, total: gates.length, gates, config };
}

function parseReleaseConfig(env: NodeJS.ProcessEnv): ReleaseConfig {
  return {
    primaryRpcUrl: env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY?.trim() ?? "",
    secondaryRpcUrl: env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY?.trim() ?? "",
    canaryRpcUrl: env.HOODFLOW_CANARY_RPC_URL?.trim() ?? "",
    chainId: integer(env.HOODFLOW_CHAIN_ID),
    finalOwner: normalizedAddress(env.HOODFLOW_INITIAL_OWNER),
    guardian: normalizedAddress(env.HOODFLOW_GUARDIAN),
    feeRecipient: normalizedAddress(env.HOODFLOW_FEE_RECIPIENT),
    feeBps: integer(env.HOODFLOW_INITIAL_FEE_BPS),
    keepers: parseAddresses(env.HOODFLOW_KEEPERS),
    releaseApprovers: parseAddresses(env.HOODFLOW_RELEASE_APPROVERS),
    universalRouter: normalizedAddress(env.HOODFLOW_UNIVERSAL_ROUTER),
    permit2: normalizedAddress(env.HOODFLOW_PERMIT2),
    settlementToken: normalizedAddress(env.HOODFLOW_SETTLEMENT_TOKEN),
    maxTrancheAmount: env.HOODFLOW_MAX_TRANCHE_AMOUNT?.trim() ?? "",
    maxStrategyBudget: env.HOODFLOW_MAX_STRATEGY_BUDGET?.trim() ?? "",
    sequencerMode: env.HOODFLOW_SEQUENCER_MODE?.trim().toLowerCase() ?? "",
    sequencerFeed: env.HOODFLOW_SEQUENCER_MODE?.trim().toLowerCase() === "none"
      ? ZERO_ADDRESS
      : normalizedAddress(env.HOODFLOW_SEQUENCER_UPTIME_FEED),
    sequencerGracePeriod: integer(env.HOODFLOW_SEQUENCER_GRACE_PERIOD_SECONDS),
    tokenConfigs: parseTokenConfigs(env.HOODFLOW_TOKEN_CONFIGS),
    auditProvider: env.HOODFLOW_AUDIT_PROVIDER?.trim() ?? "",
    auditReportPath: env.HOODFLOW_AUDIT_REPORT_PATH?.trim() ?? "",
    auditReportSha256: env.HOODFLOW_AUDIT_REPORT_SHA256?.trim() ?? "",
    auditStatus: env.HOODFLOW_AUDIT_STATUS?.trim().toLowerCase() ?? "",
    canaryChainId: integer(env.HOODFLOW_CANARY_CHAIN_ID),
    canaryTransactionHash: env.HOODFLOW_CANARY_TX_HASH?.trim() ?? "",
    canaryStatus: env.HOODFLOW_CANARY_STATUS?.trim().toLowerCase() ?? "",
    monitoringReady: env.HOODFLOW_MONITORING_READY === "true",
    incidentDrillStatus: env.HOODFLOW_INCIDENT_DRILL_STATUS?.trim().toLowerCase() ?? "",
    sourceCommit: env.HOODFLOW_SOURCE_COMMIT?.trim() ?? "",
    unpauseAfterDeploy: env.HOODFLOW_UNPAUSE_AFTER_DEPLOY === "true",
  };
}

function parseTokenConfigs(raw: string | undefined): TokenReleaseConfig[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Record<string, unknown>;
      if (
        typeof candidate.token !== "string"
        || typeof candidate.feed !== "string"
        || typeof candidate.heartbeat !== "number"
        || typeof candidate.checkOraclePause !== "boolean"
      ) return [];
      return [{
        token: normalizedAddress(candidate.token),
        feed: normalizedAddress(candidate.feed),
        heartbeat: candidate.heartbeat,
        checkOraclePause: candidate.checkOraclePause,
      }];
    });
  } catch {
    return [];
  }
}

function parseAddresses(raw: string | undefined) {
  if (!raw?.trim()) return [];
  return raw.split(",").map((value) => normalizedAddress(value));
}

function normalizedAddress(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return isAddress(trimmed) ? getAddress(trimmed) : trimmed;
}

function integer(value: string | undefined) {
  if (!value?.trim()) return Number.NaN;
  return Number(value);
}

function positiveUint128(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= (1n << 128n) - 1n;
}

function isConfiguredAddress(value: string) {
  return isAddress(value)
    && value !== ZERO_ADDRESS
    && !PLACEHOLDER_PATTERN.test(value);
}

function uniqueAddresses(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function sameAddress(left: string, right: string) {
  return isAddress(left) && isAddress(right) && left.toLowerCase() === right.toLowerCase();
}

function isProductionRpcUrl(value: string, allowPublicTestnet = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || PLACEHOLDER_PATTERN.test(value)) return false;
    if (!allowPublicTestnet && url.href.replace(/\/$/, "") === PUBLIC_ROBINHOOD_RPC) return false;
    return true;
  } catch {
    return false;
  }
}

function urlHost(value: string) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}
