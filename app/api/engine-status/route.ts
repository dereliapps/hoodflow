import { Contract, JsonRpcProvider } from "ethers";
import { NextResponse } from "next/server";
import {
  HOODFLOW_DCA_ADDRESS,
  HOODFLOW_ENGINE_ABI,
  ROBINHOOD_MAINNET,
  USDG_ADDRESS,
} from "@/lib/hoodflow-mainnet";

export const dynamic = "force-dynamic";

const configuredRpcUrls = [
  ...(process.env.ROBINHOOD_RPC_URLS ?? "").split(","),
  process.env.ROBINHOOD_RPC_URL ?? "",
  ...ROBINHOOD_MAINNET.rpcUrls,
].map((url) => url.trim()).filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);

async function readEngine(rpcUrl: string) {
  const provider = new JsonRpcProvider(rpcUrl, ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
  const [blockNumber, code] = await Promise.all([
    provider.getBlockNumber(),
    provider.getCode(HOODFLOW_DCA_ADDRESS),
  ]);
  if (code === "0x") throw new Error("Engine contract is not deployed.");

  const engine = new Contract(HOODFLOW_DCA_ADDRESS, HOODFLOW_ENGINE_ABI, provider);
  const [owner, paused, settlementToken, swapAdapter, keeperCount, allowedTokenCount, maxTranche, maxBudget, inputConfig] = await Promise.all([
    engine.owner() as Promise<string>,
    engine.paused() as Promise<boolean>,
    engine.settlementToken() as Promise<string>,
    engine.swapAdapter() as Promise<string>,
    engine.keeperCount() as Promise<bigint>,
    engine.allowedTokenCount() as Promise<bigint>,
    engine.maxTrancheAmount() as Promise<bigint>,
    engine.maxStrategyBudget() as Promise<bigint>,
    engine.tokenConfigs(USDG_ADDRESS),
  ]);

  const configured = settlementToken.toLowerCase() === USDG_ADDRESS.toLowerCase()
    && swapAdapter !== "0x0000000000000000000000000000000000000000"
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
    keeperCount: keeperCount.toString(),
    allowedTokenCount: allowedTokenCount.toString(),
    checkedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const failures: string[] = [];
  for (const rpcUrl of configuredRpcUrls) {
    try {
      const status = await readEngine(rpcUrl);
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
