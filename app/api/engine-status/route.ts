import { Contract, JsonRpcProvider } from "ethers";
import { NextResponse } from "next/server";
import {
  HOODFLOW_DCA_ADDRESS,
  HOODFLOW_ENGINE_ABI,
  HOODFLOW_V4_ADAPTER_ADDRESS,
  ROBINHOOD_MAINNET,
  USDG_ADDRESS,
} from "@/lib/hoodflow-mainnet";

export const dynamic = "force-dynamic";

const configuredRpcUrls = [
  ...(process.env.ROBINHOOD_RPC_URLS ?? "").split(","),
  process.env.ROBINHOOD_RPC_URL ?? "",
  ...ROBINHOOD_MAINNET.rpcUrls,
].map((url) => url.trim()).filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);

async function readEngine(rpcUrl: string, endpointIndex: number) {
  const startedAt = Date.now();
  const provider = new JsonRpcProvider(rpcUrl, ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
  const [blockNumber, code] = await Promise.all([
    provider.getBlockNumber(),
    provider.getCode(HOODFLOW_DCA_ADDRESS),
  ]);
  if (code === "0x") throw new Error("Engine contract is not deployed.");

  const engine = new Contract(HOODFLOW_DCA_ADDRESS, HOODFLOW_ENGINE_ABI, provider);
  const [owner, paused, settlementToken, swapAdapter, keeperCount, allowedTokenCount, maxTranche, maxBudget, protocolFeeBps, inputConfig] = await Promise.all([
    engine.owner() as Promise<string>,
    engine.paused() as Promise<boolean>,
    engine.settlementToken() as Promise<string>,
    engine.swapAdapter() as Promise<string>,
    engine.keeperCount() as Promise<bigint>,
    engine.allowedTokenCount() as Promise<bigint>,
    engine.maxTrancheAmount() as Promise<bigint>,
    engine.maxStrategyBudget() as Promise<bigint>,
    engine.protocolFeeBps() as Promise<bigint>,
    engine.tokenConfigs(USDG_ADDRESS),
  ]);
  const ownerCode = await provider.getCode(owner);

  const configured = settlementToken.toLowerCase() === USDG_ADDRESS.toLowerCase()
    && swapAdapter.toLowerCase() === HOODFLOW_V4_ADAPTER_ADDRESS.toLowerCase()
    && keeperCount > 0n
    && allowedTokenCount >= 2n
    && maxTranche > 0n
    && maxBudget >= maxTranche
    && Boolean(inputConfig.allowed);

  return {
    blockNumber,
    owner,
    paused,
    configured,
    swapAdapter,
    expectedSwapAdapter: HOODFLOW_V4_ADAPTER_ADDRESS,
    keeperCount: keeperCount.toString(),
    allowedTokenCount: allowedTokenCount.toString(),
    protocolFeeBps: Number(protocolFeeBps),
    ownerType: ownerCode === "0x" ? "EOA" : "Contract",
    rpc: {
      mode: "automatic-failover",
      endpoint: endpointIndex === 0 ? "Primary" : `Fallback ${endpointIndex}`,
      configuredEndpoints: configuredRpcUrls.length,
      latencyMs: Date.now() - startedAt,
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const failures: string[] = [];
  for (const [endpointIndex, rpcUrl] of configuredRpcUrls.entries()) {
    try {
      const status = await readEngine(rpcUrl, endpointIndex);
      return NextResponse.json(status, {
        headers: { "cache-control": "no-store, max-age=0" },
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Unknown RPC error");
    }
  }

  return NextResponse.json({
    error: "Engine verification is temporarily unavailable.",
    attempts: failures.length,
  }, { status: 503, headers: { "cache-control": "no-store, max-age=0" } });
}
