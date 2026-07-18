import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
