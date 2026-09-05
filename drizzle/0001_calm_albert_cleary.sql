ALTER TABLE `audit_events` ADD `sequence` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Preserve insertion order for existing audit chains, including equal timestamps.
UPDATE `audit_events` SET `sequence` = (
  SELECT COUNT(*) FROM `audit_events` AS prior
  WHERE prior.run_id = audit_events.run_id AND prior.rowid <= audit_events.rowid
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_audit_events_run_sequence` ON `audit_events` (`run_id`,`sequence`);
--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD `request_hash` text;
--> statement-breakpoint
ALTER TABLE `stress_runs` ADD `revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `stress_runs` SET `revision` = (
  SELECT COALESCE(MAX(sequence), 0) FROM audit_events WHERE run_id = stress_runs.id
);
