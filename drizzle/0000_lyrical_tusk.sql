CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`event_type` text NOT NULL,
	`detail_json` text NOT NULL,
	`previous_hash` text,
	`event_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `stress_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_run_created` ON `audit_events` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`run_id` text NOT NULL,
	`operation` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `key`),
	FOREIGN KEY (`run_id`) REFERENCES `stress_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment_intents` (
	`run_id` text NOT NULL,
	`intent_id` text NOT NULL,
	`entity` text NOT NULL,
	`action` text NOT NULL,
	`destination` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`individual_policy` text NOT NULL,
	`status` text NOT NULL,
	`critical` integer NOT NULL,
	`nonce` text NOT NULL,
	`commitment` text NOT NULL,
	`released_at` text,
	PRIMARY KEY(`run_id`, `intent_id`),
	FOREIGN KEY (`run_id`) REFERENCES `stress_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_payment_intents_run_nonce` ON `payment_intents` (`run_id`,`nonce`);--> statement-breakpoint
CREATE INDEX `idx_payment_intents_run_status` ON `payment_intents` (`run_id`,`status`);--> statement-breakpoint
CREATE TABLE `stress_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`severity` real NOT NULL,
	`liquidity_floor` integer NOT NULL,
	`state` text NOT NULL,
	`reason_code` text NOT NULL,
	`directional_agreement` real NOT NULL,
	`destination_concentration` real NOT NULL,
	`proposed_outflow` integer NOT NULL,
	`projected_buffer` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stress_runs_created_at` ON `stress_runs` (`created_at`);--> statement-breakpoint
PRAGMA optimize;
