import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const analyticsEvents = sqliteTable("analytics_events", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  path: text("path").notNull(),
  ticker: text("ticker"),
  sessionId: text("session_id").notNull(),
  referrer: text("referrer").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  index("analytics_event_time_idx").on(table.event, table.createdAt),
  index("analytics_session_time_idx").on(table.sessionId, table.createdAt),
]);

export const referralProfiles = sqliteTable("referral_profiles", {
  wallet: text("wallet").primaryKey(),
  code: text("code").notNull(),
  points: integer("points").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("referral_profile_code_idx").on(table.code),
  index("referral_profile_points_idx").on(table.points),
]);

export const referralAttributions = sqliteTable("referral_attributions", {
  inviteeWallet: text("invitee_wallet").primaryKey(),
  referrerWallet: text("referrer_wallet").notNull(),
  referralCode: text("referral_code").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  qualifiedAt: integer("qualified_at", { mode: "timestamp" }),
}, (table) => [
  index("referral_attribution_referrer_idx").on(table.referrerWallet, table.status),
]);

export const referralClaims = sqliteTable("referral_claims", {
  txHash: text("tx_hash").primaryKey(),
  inviteeWallet: text("invitee_wallet").notNull(),
  referrerWallet: text("referrer_wallet").notNull(),
  inviteePoints: integer("invitee_points").notNull(),
  referrerPoints: integer("referrer_points").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("referral_claim_invitee_idx").on(table.inviteeWallet),
  index("referral_claim_referrer_idx").on(table.referrerWallet),
]);
