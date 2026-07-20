CREATE TABLE `asset_request_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`ticker` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_request_wallet_ticker_idx` ON `asset_request_votes` (`wallet`,`ticker`);--> statement-breakpoint
CREATE INDEX `asset_request_ticker_time_idx` ON `asset_request_votes` (`ticker`,`created_at`);--> statement-breakpoint
CREATE INDEX `asset_request_wallet_time_idx` ON `asset_request_votes` (`wallet`,`created_at`);