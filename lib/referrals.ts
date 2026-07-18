export const INVITEE_POINTS = 100;
export const REFERRER_POINTS = 500;
export const SEASON_REFERRAL_CAP = 25;

export function buildReferralMessage(wallet: string, timestamp: number, referralCode = "") {
  return [
    "HoodFlow Referral Season 0",
    `Wallet: ${wallet}`,
    `Referral: ${referralCode || "none"}`,
    `Timestamp: ${timestamp}`,
    "This signature only activates a HoodFlow referral profile. It does not authorize a transaction.",
  ].join("\n");
}

