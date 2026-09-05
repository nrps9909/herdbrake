CREATE TABLE `policy_versions` (
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`policy_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `request_limits` (
	`owner_id` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `window`)
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`policy_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `source` text DEFAULT 'scenario' NOT NULL;--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `policy_json` text;--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `policy_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `intent_count` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_runs_owner_created` ON `stress_runs` (`owner_id`,`created_at`);