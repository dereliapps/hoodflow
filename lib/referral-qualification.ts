import { AbiCoder, getAddress, Interface, Result, ZeroAddress, id, zeroPadValue } from "ethers";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_TOKENS,
  ROUTED_ASSETS,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  USDG_DECIMALS,
  V3_ROUTE_FEES,
  V4_POOL_CANDIDATES,
} from "@/lib/hoodflow-mainnet";

const ROUTER_INTERFACE = new Interface(UNIVERSAL_ROUTER_ABI);
const CODER = AbiCoder.defaultAbiCoder();
const TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const MINIMUM_USDG_VALUE = 10n ** BigInt(USDG_DECIMALS);
const ROUTED_TOKEN_TO_TICKER = new Map(
  ROUTED_ASSETS.map((ticker) => [ROBINHOOD_TOKENS[ticker].toLowerCase(), ticker]),
);

type ReceiptLog = { address: string; topics: readonly string[]; data: string };
type SwapShape = {
  protocol: "V3" | "V4";
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  minimumOut: bigint;
};

function decodePermit(input: string) {
  const [permitValue] = CODER.decode([
    "tuple(tuple(address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline)",
    "bytes",
  ], input);
  const permit = permitValue as Result;
  const details = permit[0] as Result;
  return {
    token: getAddress(String(details[0])),
    amount: BigInt(details[1]),
    spender: getAddress(String(permit[1])),
  };
}

function decodeV3(input: string, wallet: string): SwapShape {
  const [recipientValue, amountInValue, minimumOutValue, pathValue, payerIsUserValue] = CODER.decode(
    ["address", "uint256", "uint256", "bytes", "bool"],
    input,
  );
  const path = String(pathValue).toLowerCase();
  if (!/^0x[a-f0-9]{86}$/.test(path)) throw new Error("The referral trade uses an unsupported V3 path.");
  const tokenIn = getAddress(`0x${path.slice(2, 42)}`);
  const fee = Number.parseInt(path.slice(42, 48), 16);
  const tokenOut = getAddress(`0x${path.slice(48, 88)}`);
  if (getAddress(String(recipientValue)) !== wallet || !Boolean(payerIsUserValue)) {
    throw new Error("The referral trade recipient does not match the invitee wallet.");
  }
  const ticker = ROUTED_TOKEN_TO_TICKER.get((tokenIn === USDG_ADDRESS ? tokenOut : tokenIn).toLowerCase());
  if (!ticker || V3_ROUTE_FEES[ticker] !== fee) throw new Error("The referral trade is not a reviewed HoodFlow V3 route.");
  return { protocol: "V3", tokenIn, tokenOut, amountIn: BigInt(amountInValue), minimumOut: BigInt(minimumOutValue) };
}

function decodeV4(input: string): SwapShape {
  const [actionsValue, paramsValue] = CODER.decode(["bytes", "bytes[]"], input);
  const actions = String(actionsValue).toLowerCase();
  const params = Array.from(paramsValue as Result, (value) => String(value));
  if (actions !== "0x060c0f" || params.length !== 3) throw new Error("The referral trade uses an unsupported V4 action plan.");

  const [swapValue] = CODER.decode([
    "tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)",
  ], params[0]);
  const swap = swapValue as Result;
  const poolKey = swap[0] as Result;
  const currency0 = getAddress(String(poolKey[0]));
  const currency1 = getAddress(String(poolKey[1]));
  const fee = Number(poolKey[2]);
  const tickSpacing = Number(poolKey[3]);
  const hooks = getAddress(String(poolKey[4]));
  const zeroForOne = Boolean(swap[1]);
  const tokenIn = zeroForOne ? currency0 : currency1;
  const tokenOut = zeroForOne ? currency1 : currency0;
  const amountIn = BigInt(swap[2]);
  const minimumOut = BigInt(swap[3]);
  const [settleToken, settleAmount] = CODER.decode(["address", "uint256"], params[1]);
  const [takeToken, takeMinimum] = CODER.decode(["address", "uint256"], params[2]);
  const reviewedPool = V4_POOL_CANDIDATES.some((candidate) => candidate.fee === fee && candidate.tickSpacing === tickSpacing);
  if (!reviewedPool || hooks !== ZeroAddress
    || getAddress(String(settleToken)) !== tokenIn || BigInt(settleAmount) !== amountIn
    || getAddress(String(takeToken)) !== tokenOut || BigInt(takeMinimum) !== minimumOut) {
    throw new Error("The referral trade is not a reviewed HoodFlow V4 route.");
  }
  const ticker = ROUTED_TOKEN_TO_TICKER.get((tokenIn === USDG_ADDRESS ? tokenOut : tokenIn).toLowerCase());
  if (!ticker || V3_ROUTE_FEES[ticker]) throw new Error("The referral trade is not a reviewed HoodFlow V4 market.");
  return { protocol: "V4", tokenIn, tokenOut, amountIn, minimumOut };
}

function outputReceived(logs: readonly ReceiptLog[], tokenOut: string, wallet: string) {
  const walletTopic = zeroPadValue(wallet, 32).toLowerCase();
  return logs.reduce((total, log) => {
    if (log.address.toLowerCase() !== tokenOut.toLowerCase()
      || log.topics.length !== 3
      || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC
      || log.topics[2]?.toLowerCase() !== walletTopic
      || !/^0x[a-fA-F0-9]{64}$/.test(log.data)) return total;
    return total + BigInt(log.data);
  }, 0n);
}

export function verifyEligibleReferralTrade(args: {
  transactionData: string;
  wallet: string;
  logs: readonly ReceiptLog[];
}) {
  const wallet = getAddress(args.wallet);
  const [commandsValue, inputsValue] = ROUTER_INTERFACE.decodeFunctionData("execute", args.transactionData);
  const commands = String(commandsValue).toLowerCase();
  const inputs = Array.from(inputsValue as Result, (value) => String(value));
  if ((commands !== "0x0a00" && commands !== "0x0a10") || inputs.length !== 2) {
    throw new Error("The transaction does not contain a supported HoodFlow route.");
  }

  const permit = decodePermit(inputs[0]);
  const swap = commands === "0x0a00" ? decodeV3(inputs[1], wallet) : decodeV4(inputs[1]);
  const stockToken = swap.tokenIn === USDG_ADDRESS ? swap.tokenOut : swap.tokenOut === USDG_ADDRESS ? swap.tokenIn : null;
  if (!stockToken || !ROUTED_TOKEN_TO_TICKER.has(stockToken.toLowerCase())) {
    throw new Error("Only reviewed USDG Stock Token routes qualify for referral points.");
  }
  if (permit.spender !== UNIVERSAL_ROUTER_ADDRESS || permit.token !== swap.tokenIn || permit.amount < swap.amountIn) {
    throw new Error("The transaction permit does not match the qualifying swap.");
  }
  if (PERMIT2_ADDRESS === ZeroAddress) throw new Error("Referral qualification is unavailable.");

  const received = outputReceived(args.logs, swap.tokenOut, wallet);
  if (received < swap.minimumOut || received <= 0n) throw new Error("The qualifying output was not settled to the invitee wallet.");
  if (swap.tokenIn === USDG_ADDRESS ? swap.amountIn < MINIMUM_USDG_VALUE : received < MINIMUM_USDG_VALUE) {
    throw new Error("An eligible referral trade must settle at least 1 USDG of value.");
  }
  return { ...swap, received, ticker: ROUTED_TOKEN_TO_TICKER.get(stockToken.toLowerCase())! };
}
