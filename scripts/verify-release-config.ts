import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { JsonRpcProvider, keccak256 } from "ethers";

import { evaluateReleaseEnvironment, MAINNET_CHAIN_ID } from "./lib/mainnet-release.js";

try {
  process.loadEnvFile?.();
} catch {
  // CI and release systems can inject the same values without a local .env file.
}

const jsonOutput = process.argv.includes("--json");
const offline = process.argv.includes("--offline");
const report = evaluateReleaseEnvironment(process.env);
const onlineChecks: Array<{ id: string; passed: boolean; detail: string }> = [];

try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  onlineChecks.push({
    id: "source-head",
    passed: head.toLowerCase() === report.config.sourceCommit.toLowerCase(),
    detail: head.toLowerCase() === report.config.sourceCommit.toLowerCase()
      ? `Release commit matches HEAD ${head.slice(0, 8)}`
      : `Configured commit does not match HEAD ${head.slice(0, 8)}`,
  });
  onlineChecks.push({
    id: "clean-tree",
    passed: status.length === 0,
    detail: status.length === 0 ? "Git worktree is clean" : "Git worktree contains uncommitted changes",
  });
} catch {
  onlineChecks.push({ id: "source-head", passed: false, detail: "Could not verify the git release commit" });
  onlineChecks.push({ id: "clean-tree", passed: false, detail: "Could not verify the git worktree" });
}

if (report.gates.find((gate) => gate.id === "audit")?.passed) {
  try {
    const auditReport = await readFile(report.config.auditReportPath);
    const digest = createHash("sha256").update(auditReport).digest("hex");
    onlineChecks.push({
      id: "audit-file",
      passed: digest.toLowerCase() === report.config.auditReportSha256.toLowerCase(),
      detail: digest.toLowerCase() === report.config.auditReportSha256.toLowerCase()
        ? "Audit report file matches the recorded SHA-256"
        : "Audit report SHA-256 does not match the recorded value",
    });
  } catch {
    onlineChecks.push({ id: "audit-file", passed: false, detail: "Audit report file could not be read" });
  }
}

if (!offline && report.gates.find((gate) => gate.id === "rpc")?.passed) {
  const providers = [
    new JsonRpcProvider(report.config.primaryRpcUrl, MAINNET_CHAIN_ID, { staticNetwork: true }),
    new JsonRpcProvider(report.config.secondaryRpcUrl, MAINNET_CHAIN_ID, { staticNetwork: true }),
  ];
  const [primaryNetwork, secondaryNetwork, primaryBlock, secondaryBlock] = await Promise.all([
    providers[0].getNetwork(),
    providers[1].getNetwork(),
    providers[0].getBlockNumber(),
    providers[1].getBlockNumber(),
  ]);
  const networksMatch = Number(primaryNetwork.chainId) === MAINNET_CHAIN_ID
    && Number(secondaryNetwork.chainId) === MAINNET_CHAIN_ID;
  onlineChecks.push({
    id: "rpc-chain",
    passed: networksMatch,
    detail: networksMatch
      ? `Both providers report chain ${MAINNET_CHAIN_ID}`
      : `RPC chain mismatch: ${primaryNetwork.chainId}/${secondaryNetwork.chainId}`,
  });
  const blockDrift = Math.abs(primaryBlock - secondaryBlock);
  onlineChecks.push({
    id: "rpc-head",
    passed: blockDrift <= 20,
    detail: `Provider heads ${primaryBlock}/${secondaryBlock}; drift ${blockDrift}`,
  });

  const bytecodeTargets = [
    ["owner multisig", report.config.finalOwner],
    ["Universal Router", report.config.universalRouter],
    ["Permit2", report.config.permit2],
    ["sequencer feed", report.config.sequencerFeed],
    ...report.config.tokenConfigs.flatMap((item, index) => [
      [`token ${index + 1}`, item.token],
      [`price feed ${index + 1}`, item.feed],
    ] as Array<[string, string]>),
  ] as Array<[string, string]>;
  const codeResults = await Promise.all(bytecodeTargets.map(async ([label, address]) => {
    try {
      const [primaryCode, secondaryCode] = await Promise.all([
        providers[0].getCode(address),
        providers[1].getCode(address),
      ]);
      return {
        label,
        address,
        passed: primaryCode !== "0x" && secondaryCode !== "0x" && keccak256(primaryCode) === keccak256(secondaryCode),
      };
    } catch {
      return { label, address, passed: false };
    }
  }));
  const failedTargets = codeResults.filter((item) => !item.passed);
  onlineChecks.push({
    id: "bytecode",
    passed: failedTargets.length === 0,
    detail: failedTargets.length === 0
      ? `${codeResults.length} targets have matching bytecode through both RPCs`
      : `Missing or inconsistent code: ${failedTargets.map((item) => item.label).join(", ")}`,
  });
}

const canaryGate = report.gates.find((gate) => gate.id === "canary");
if (!offline && canaryGate?.passed) {
  try {
    const provider = new JsonRpcProvider(report.config.canaryRpcUrl, report.config.canaryChainId, { staticNetwork: true });
    const [network, receipt] = await Promise.all([
      provider.getNetwork(),
      provider.getTransactionReceipt(report.config.canaryTransactionHash),
    ]);
    const passed = Number(network.chainId) === report.config.canaryChainId && receipt?.status === 1;
    onlineChecks.push({
      id: "canary-receipt",
      passed,
      detail: passed
        ? `Canary confirmed in block ${receipt.blockNumber}`
        : "Canary receipt is missing, failed, or on the wrong network",
    });
  } catch {
    onlineChecks.push({ id: "canary-receipt", passed: false, detail: "Canary RPC verification failed" });
  }
}

const onlinePassed = onlineChecks.filter((item) => item.passed).length;
const ready = report.ready && onlineChecks.length > 0 && onlinePassed === onlineChecks.length;
const output = {
  ready,
  mode: offline ? "offline" : "online",
  passed: report.passed + onlinePassed,
  total: report.total + onlineChecks.length,
  gates: report.gates,
  onlineChecks,
};

if (jsonOutput) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`\nHoodFlow mainnet release gate: ${output.passed}/${output.total} passed\n`);
  for (const gate of report.gates) {
    console.log(`${gate.passed ? "PASS" : "BLOCK"}  ${gate.label} — ${gate.detail}`);
  }
  for (const check of onlineChecks) {
    console.log(`${check.passed ? "PASS" : "BLOCK"}  ${check.id} — ${check.detail}`);
  }
  console.log(ready
    ? "\nREADY: configuration and live read-only checks passed. This command never broadcasts."
    : "\nLOCKED: resolve every BLOCK before preparing a mainnet deployment.");
}

if (!ready) process.exitCode = 1;
