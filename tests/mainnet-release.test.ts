import assert from "node:assert/strict";
import test from "node:test";

import { evaluateReleaseEnvironment } from "../scripts/lib/mainnet-release.js";

const ADDRESS = {
  owner: "0x1111111111111111111111111111111111111111",
  guardian: "0x2222222222222222222222222222222222222222",
  fee: "0x3333333333333333333333333333333333333333",
  keeper: "0x4444444444444444444444444444444444444444",
  approver1: "0x5555555555555555555555555555555555555555",
  approver2: "0x6666666666666666666666666666666666666666",
  sequencer: "0x7777777777777777777777777777777777777777",
  feed1: "0x8888888888888888888888888888888888888888",
  feed2: "0x9999999999999999999999999999999999999999",
};

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    HOODFLOW_CHAIN_ID: "4663",
    ROBINHOOD_MAINNET_RPC_URL_PRIMARY: "https://mainnet-a.provider-one.dev/key",
    ROBINHOOD_MAINNET_RPC_URL_SECONDARY: "https://mainnet-b.provider-two.dev/key",
    HOODFLOW_CANARY_RPC_URL: "https://testnet.provider.dev/key",
    HOODFLOW_INITIAL_OWNER: ADDRESS.owner,
    HOODFLOW_GUARDIAN: ADDRESS.guardian,
    HOODFLOW_FEE_RECIPIENT: ADDRESS.fee,
    HOODFLOW_INITIAL_FEE_BPS: "10",
    HOODFLOW_KEEPERS: ADDRESS.keeper,
    HOODFLOW_RELEASE_APPROVERS: `${ADDRESS.approver1},${ADDRESS.approver2}`,
    HOODFLOW_UNIVERSAL_ROUTER: "0x8876789976decbfcbbbe364623c63652db8c0904",
    HOODFLOW_PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    HOODFLOW_SEQUENCER_UPTIME_FEED: ADDRESS.sequencer,
    HOODFLOW_SEQUENCER_GRACE_PERIOD_SECONDS: "3600",
    HOODFLOW_TOKEN_CONFIGS: JSON.stringify([
      {
        token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        feed: ADDRESS.feed1,
        heartbeat: 3600,
        checkOraclePause: false,
      },
      {
        token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
        feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
        heartbeat: 86400,
        checkOraclePause: true,
      },
    ]),
    HOODFLOW_AUDIT_PROVIDER: "Independent Security Labs",
    HOODFLOW_AUDIT_REPORT_PATH: "/secure/hoodflow-final-audit.pdf",
    HOODFLOW_AUDIT_REPORT_SHA256: "a".repeat(64),
    HOODFLOW_AUDIT_STATUS: "passed",
    HOODFLOW_CANARY_CHAIN_ID: "46630",
    HOODFLOW_CANARY_TX_HASH: `0x${"b".repeat(64)}`,
    HOODFLOW_CANARY_STATUS: "passed",
    HOODFLOW_MONITORING_READY: "true",
    HOODFLOW_INCIDENT_DRILL_STATUS: "passed",
    HOODFLOW_SOURCE_COMMIT: "c".repeat(40),
    HOODFLOW_UNPAUSE_AFTER_DEPLOY: "false",
  };
}

test("accepts a complete fail-closed release environment", () => {
  const report = evaluateReleaseEnvironment(validEnvironment());
  assert.equal(report.ready, true);
  assert.equal(report.passed, report.total);
  assert.equal(report.total, 14);
});

test("blocks a single public RPC and an unpaused deployment", () => {
  const env = validEnvironment();
  env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY = "https://rpc.mainnet.chain.robinhood.com";
  env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY = "https://rpc.mainnet.chain.robinhood.com";
  env.HOODFLOW_UNPAUSE_AFTER_DEPLOY = "true";
  const report = evaluateReleaseEnvironment(env);
  assert.equal(report.ready, false);
  assert.equal(report.gates.find((gate) => gate.id === "rpc")?.passed, false);
  assert.equal(report.gates.find((gate) => gate.id === "broadcast")?.passed, false);
});

test("blocks noncanonical assets and stock configs without pause checks", () => {
  const env = validEnvironment();
  env.HOODFLOW_TOKEN_CONFIGS = JSON.stringify([
    {
      token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      feed: ADDRESS.feed1,
      heartbeat: 3600,
      checkOraclePause: false,
    },
    {
      token: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      feed: ADDRESS.feed2,
      heartbeat: 3600,
      checkOraclePause: false,
    },
  ]);
  const report = evaluateReleaseEnvironment(env);
  assert.equal(report.ready, false);
  assert.equal(report.gates.find((gate) => gate.id === "oracles")?.passed, false);
});

test("blocks a canonical stock when its feed does not match the current Chainlink registry", () => {
  const env = validEnvironment();
  const configs = JSON.parse(env.HOODFLOW_TOKEN_CONFIGS ?? "[]") as Array<Record<string, unknown>>;
  configs[1].feed = ADDRESS.feed2;
  env.HOODFLOW_TOKEN_CONFIGS = JSON.stringify(configs);
  const report = evaluateReleaseEnvironment(env);
  assert.equal(report.ready, false);
  assert.equal(report.gates.find((gate) => gate.id === "oracles")?.passed, false);
});

test("blocks a funded mainnet key from the read-only release gate", () => {
  const env = validEnvironment();
  env.ROBINHOOD_MAINNET_PRIVATE_KEY = `0x${"d".repeat(64)}`;
  const report = evaluateReleaseEnvironment(env);
  assert.equal(report.ready, false);
  assert.equal(report.gates.find((gate) => gate.id === "broadcast")?.passed, false);
});
