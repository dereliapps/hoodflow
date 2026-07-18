CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`path` text NOT NULL,
	`ticker` text,
	`session_id` text NOT NULL,
	`referrer` text NOT NULL,
	`created_at` integer NOT NULL
);
