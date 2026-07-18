export const VIRTUALS_API_ROOT = "https://api.virtuals.io";
export const ROBINHOOD_VIRTUAL_ADDRESS = "0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type VirtualsLifecycle = "bonding" | "graduated";

export type VirtualsToken = {
  id?: number;
  name?: string;
  symbol?: string;
  description?: string;
  status?: string;
  chain?: string;
  factory?: string;
  preToken?: string | null;
  tokenAddress?: string | null;
  preTokenPair?: string | null;
  lpAddress?: string | null;
  totalValueLocked?: string | number;
  totalSupply?: string | number;
  holderCount?: number;
  volume24h?: number;
  priceChangePercent24h?: number;
  liquidityUsd?: number;
  mcapInVirtual?: number;
  fdvInVirtual?: number;
  createdAt?: string;
  launchedAt?: string;
  image?: { url?: string | null } | null;
};

export type VirtualsListing = {
  address: string;
  name: string;
  symbol: string;
  lifecycle: VirtualsLifecycle;
  pairAddress: string;
  externalUrl: string;
  imageUrl: string | null;
  holderCount: number;
  volume24h: number;
  priceChange24h: number | null;
  liquidityUsd: number;
  fdvInVirtual: number | null;
  bondedVirtual: number | null;
  launchedAt: string | null;
  factory: string;
};

function finite(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function address(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) && normalized !== ZERO_ADDRESS ? normalized : "";
}

export function normalizeVirtualsToken(token: VirtualsToken): VirtualsListing | null {
  if (String(token.chain ?? "").toUpperCase() !== "ROBINHOOD") return null;
  const graduatedAddress = address(token.tokenAddress);
  const prototypeAddress = address(token.preToken);
  const lifecycle: VirtualsLifecycle = graduatedAddress && String(token.status ?? "").toUpperCase() !== "UNDERGRAD"
    ? "graduated"
    : "bonding";
  const tokenAddress = lifecycle === "graduated" ? graduatedAddress : prototypeAddress;
  if (!tokenAddress || !token.symbol) return null;
  const id = Number(token.id);
  return {
    address: tokenAddress,
    name: String(token.name || token.symbol).slice(0, 80),
    symbol: String(token.symbol).slice(0, 20),
    lifecycle,
    pairAddress: address(lifecycle === "graduated" ? token.lpAddress : token.preTokenPair),
    externalUrl: Number.isInteger(id) && id > 0 ? `https://app.virtuals.io/virtuals/${id}` : "https://app.virtuals.io/",
    imageUrl: token.image?.url || null,
    holderCount: Math.max(0, Math.trunc(finite(token.holderCount))),
    volume24h: Math.max(0, finite(token.volume24h)),
    priceChange24h: nullableNumber(token.priceChangePercent24h),
    liquidityUsd: Math.max(0, finite(token.liquidityUsd)),
    fdvInVirtual: nullableNumber(token.fdvInVirtual) ?? nullableNumber(token.mcapInVirtual),
    bondedVirtual: nullableNumber(token.totalValueLocked),
    launchedAt: token.launchedAt || token.createdAt || null,
    factory: String(token.factory || "Virtuals").slice(0, 40),
  };
}

export function virtualsQuery(params: Record<string, string>) {
  return `${VIRTUALS_API_ROOT}/api/virtuals?${new URLSearchParams({
    "filters[chain]": "ROBINHOOD",
    "populate[0]": "image",
    ...params,
  }).toString()}`;
}

