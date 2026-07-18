CREATE TABLE `referral_attributions` (
	`invitee_wallet` text PRIMARY KEY NOT NULL,
	`referrer_wallet` text NOT NULL,
	`referral_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`qualified_at` integer
);
--> statement-breakpoint
CREATE INDEX `referral_attribution_referrer_idx` ON `referral_attributions` (`referrer_wallet`,`status`);--> statement-breakpoint
CREATE TABLE `referral_claims` (
	`tx_hash` text PRIMARY KEY NOT NULL,
	`invitee_wallet` text NOT NULL,
	`referrer_wallet` text NOT NULL,
	`invitee_points` integer NOT NULL,
	`referrer_points` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_claim_invitee_idx` ON `referral_claims` (`invitee_wallet`);--> statement-breakpoint
CREATE INDEX `referral_claim_referrer_idx` ON `referral_claims` (`referrer_wallet`);--> statement-breakpoint
CREATE TABLE `referral_profiles` (
	`wallet` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_profile_code_idx` ON `referral_profiles` (`code`);--> statement-breakpoint
CREATE INDEX `referral_profile_points_idx` ON `referral_profiles` (`points`);