import robinhoodMainnet from "../../config/robinhood-mainnet.json" with { type: "json" };

export const PAYDAY_FIXTURE_TIME = "2026-08-12T12:00:00.000Z";
export const PAYDAY_FIXTURE_UID = `0x${"11".repeat(32)}`;

export function paydayAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYDAY_FIXTURE_UID,
    tokenSymbol: "AAPL",
    tokenName: "Apple · Robinhood Token",
    deployments: [{
      chainId: 4663,
      contractAddress: robinhoodMainnet.tokens.AAPL,
      networkName: "Robinhood Chain",
    }],
    currentMultiplier: "1.000000000000000000",
    pendingMultiplier: "1.500000000000000000",
    pendingMultiplierEffectiveTime: "2026-08-13T13:30:00.000Z",
    status: "ASSET_STATUS_ACTIVE",
    tokenDecimals: 18,
    logoUrl: "https://cdn.robinhood.com/ncw_assets/logos/aapl.png",
    ...overrides,
  };
}

export function paydayAction(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYDAY_FIXTURE_UID,
    tokenSymbol: "AAPL",
    type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND",
    status: "CORPORATE_ACTION_STATUS_IN_PROGRESS",
    processDate: { year: 2026, month: 8, day: 13 },
    deployments: [{
      chainId: 4663,
      contractAddress: robinhoodMainnet.tokens.AAPL,
      networkName: "Robinhood Chain",
    }],
    details: {
      cashDividend: {
        underlyingSymbol: "AAPL",
        rate: "0.25",
        currency: "USD",
      },
    },
    ...overrides,
  };
}

export function paydayFetch(
  asset = paydayAsset(),
  actions: unknown[] = [paydayAction()],
) {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    if (url.endsWith("/rhj/assets")) return Response.json({ assets: [asset] });
    if (url.endsWith("/rhj/corporate-actions")) return Response.json({ corpActions: actions });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

export function paydayOnchain(overrides: Record<string, unknown> = {}) {
  return async () => ({
    chainId: 4663,
    uid: PAYDAY_FIXTURE_UID,
    currentMultiplier: "1.000000000000000000",
    pendingMultiplier: "1.500000000000000000",
    effectiveAt: "2026-08-13T13:30:00.000Z",
    ...overrides,
  });
}
