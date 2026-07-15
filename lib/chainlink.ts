const WORD_HEX_LENGTH = 64;
const LATEST_ROUND_WORDS = 5;
const UINT256_MODULUS = 1n << 256n;
const INT256_SIGN_BIT = 1n << 255n;

export type DecodedRound = {
  roundId: bigint;
  answer: bigint;
  updatedAt: number;
  answeredInRound: bigint;
};

export function decodeLatestRoundData(data: unknown): DecodedRound | null {
  if (typeof data !== "string" || !data.startsWith("0x")) return null;
  const payload = data.slice(2);
  if (payload.length !== WORD_HEX_LENGTH * LATEST_ROUND_WORDS || !/^[0-9a-f]+$/i.test(payload)) {
    return null;
  }

  const words = Array.from({ length: LATEST_ROUND_WORDS }, (_, index) =>
    BigInt(`0x${payload.slice(index * WORD_HEX_LENGTH, (index + 1) * WORD_HEX_LENGTH)}`));
  const unsignedAnswer = words[1];
  const answer = unsignedAnswer >= INT256_SIGN_BIT ? unsignedAnswer - UINT256_MODULUS : unsignedAnswer;
  const updatedAt = Number(words[3]);
  if (!Number.isSafeInteger(updatedAt)) return null;
  return {
    roundId: words[0],
    answer,
    updatedAt,
    answeredInRound: words[4],
  };
}

export function decodeBoolean(data: unknown): boolean | null {
  if (typeof data !== "string" || !/^0x[0-9a-f]{64}$/i.test(data)) return null;
  const value = BigInt(data);
  return value === 0n ? false : value === 1n ? true : null;
}

export function scalePrice(answer: bigint, decimals: number) {
  if (answer <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const price = Number(answer) / 10 ** decimals;
  return Number.isFinite(price) && price > 0 ? price : null;
}
