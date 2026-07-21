CREATE TABLE `agent_quote_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_quote_rate_updated_idx` ON `agent_quote_rate_limits` (`updated_at`);