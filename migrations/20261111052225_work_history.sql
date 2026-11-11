CREATE TABLE `work_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text NOT NULL,
	`holder` text NOT NULL,
	`lease_id` text NOT NULL,
	`claimed_at` text NOT NULL,
	`completed_at` text NOT NULL,
	`seconds` real NOT NULL,
	`note` text,
	`outcome` text NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_attempts_outcome" CHECK("work_attempts"."outcome" in ('waiting_on_review', 'closed', 'progressed', 'no_progress', 'stuck'))
);
--> statement-breakpoint
CREATE INDEX `work_attempts_completed_idx` ON `work_attempts` (`completed_at`,`id`);--> statement-breakpoint
CREATE INDEX `work_attempts_item_idx` ON `work_attempts` (`item_id`,`outcome`);--> statement-breakpoint
CREATE TABLE `work_item_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text NOT NULL,
	`gap` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_item_log_created_idx` ON `work_item_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `work_item_log_closed_idx` ON `work_item_log` (`closed_at`) WHERE closed_at is not null;--> statement-breakpoint
CREATE INDEX `work_item_log_subject_idx` ON `work_item_log` (`subject_id`);--> statement-breakpoint
ALTER TABLE `worklist` ADD `slots_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `slots_published` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `slots_pending` integer DEFAULT 0 NOT NULL;