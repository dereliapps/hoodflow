import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../app/api/community-markets/chart/route";

const token = "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a";
const unindexedPool = "0xbacc7e8808ae4c27da59a149dfe83ffaf61c3e1a";
const fallbackPool = "0x382388e2afeae1ca3740dacfecea03cbc3419cba51dbeca026c1e5d8218e19c1";

test("falls back from an unindexed pair address to the token's indexed pool", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes(`/pools/${unindexedPool}/ohlcv/`)) return new Response("missing", { status: 404 });
    if (url.includes(`/tokens/${token}/pools`)) {
      return Response.json({ data: [{ id: `robinhood_${fallbackPool}` }] });
    }
    if (url.includes(`/pools/${fallbackPool}/ohlcv/`)) {
      return Response.json({ data: { attributes: { ohlcv_list: [
        [1_784_728_800, 126, 132, 124, 131, 54_148],
        [1_784_732_400, 131, 133, 121, 127, 26_310],
      ] } } });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    const response = await GET(new Request(`https://hoodflow.app/api/community-markets/chart?pool=${unindexedPool}&token=${token}&range=7D`));
    const payload = await response.json() as { points?: unknown[]; fallbackPool?: boolean; resolvedPool?: string };
    assert.equal(response.status, 200);
    assert.equal(payload.points?.length, 2);
    assert.equal(payload.fallbackPool, true);
    assert.equal(payload.resolvedPool, fallbackPool);
    assert.equal(requested.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
