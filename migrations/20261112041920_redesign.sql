CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`target_type` text NOT NULL,
	`target` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`resolution_note` text,
	`resolution_fact_ids` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_open_target_idx` ON `tickets` (`type`,`target_type`,`target`) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX `tickets_status_created_idx` ON `tickets` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `tickets_target_idx` ON `tickets` (`target`,`status`);--> statement-breakpoint
CREATE TABLE `work_pass_blocks` (
	`lemma` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text NOT NULL,
	PRIMARY KEY(`lemma`, `type`, `subject_id`)
);
--> statement-breakpoint
CREATE INDEX `work_pass_blocks_slot_idx` ON `work_pass_blocks` (`type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `work_passes` (
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text NOT NULL,
	`note` text NOT NULL,
	`holder` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`type`, `subject_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `work_passes_entry_idx` ON `work_passes` (`entry_id`);--> statement-breakpoint
-- Feedback becomes tickets: an open or claimed item is an open ticket.
INSERT INTO `tickets` (`id`, `type`, `target_type`, `target`, `message`, `status`, `resolution_note`, `resolution_fact_ids`, `revision`, `created_at`, `updated_at`)
SELECT `id`, 'feedback', `target_type`, `target_id`, `message`, CASE WHEN `status` IN ('open', 'claimed') THEN 'open' ELSE `status` END, `resolution_note`, `resolution_fact_ids`, `revision`, `created_at`, `updated_at` FROM `feedback`;--> statement-breakpoint
DROP TABLE `feedback`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_attempts` (
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
	CONSTRAINT "work_attempts_outcome" CHECK("__new_work_attempts"."outcome" in ('waiting_on_review', 'closed', 'passed', 'progressed', 'no_progress', 'stuck'))
);
--> statement-breakpoint
INSERT INTO `__new_work_attempts`("id", "item_id", "entry_id", "type", "subject_id", "holder", "lease_id", "claimed_at", "completed_at", "seconds", "note", "outcome", "settled_at") SELECT "id", "item_id", "entry_id", "type", "subject_id", "holder", "lease_id", "claimed_at", "completed_at", "seconds", "note", "outcome", "settled_at" FROM `work_attempts`;--> statement-breakpoint
DROP TABLE `work_attempts`;--> statement-breakpoint
ALTER TABLE `__new_work_attempts` RENAME TO `work_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `work_attempts_completed_idx` ON `work_attempts` (`completed_at`,`id`);--> statement-breakpoint
CREATE INDEX `work_attempts_item_idx` ON `work_attempts` (`item_id`,`outcome`);--> statement-breakpoint
DROP INDEX `facts_exclusive_holder_idx`;--> statement-breakpoint
DROP INDEX `facts_exclusive_pending_idx`;--> statement-breakpoint
DROP INDEX `facts_revalidate_idx`;--> statement-breakpoint
ALTER TABLE `facts` ADD `slot` text;--> statement-breakpoint
-- The one-per-subject kinds keep their slot; the data migration rewrites the reshaped kinds, and
-- the slot indexes follow in the next migration once it has.
UPDATE `facts` SET `slot` = '' WHERE `exclusive` = 1;--> statement-breakpoint
CREATE INDEX `facts_rejected_content_idx` ON `facts` (`kind`,`subject_id`,`content_key`) WHERE status = 'rejected';--> statement-breakpoint
ALTER TABLE `facts` DROP COLUMN `exclusive`;--> statement-breakpoint
ALTER TABLE `facts` DROP COLUMN `revalidate_since`;--> statement-breakpoint
DROP INDEX `work_items_curation_idx`;--> statement-breakpoint
DROP INDEX `work_items_queue_idx`;--> statement-breakpoint
DROP INDEX `work_items_type_queue_idx`;--> statement-breakpoint
ALTER TABLE `work_items` ADD `found_none` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `work_items_queue_idx` ON `work_items` (`rank`,"zipf_order" desc,`created_at`,`id`) WHERE awaiting = 0 and attempts < 2;--> statement-breakpoint
CREATE INDEX `work_items_type_queue_idx` ON `work_items` (`type`,`rank`,"zipf_order" desc,`created_at`,`id`) WHERE awaiting = 0 and attempts < 2;--> statement-breakpoint
ALTER TABLE `worklist` ADD `batch` integer;--> statement-breakpoint
ALTER TABLE `worklist` ADD `credibility` real DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Seeded entries are the first headword batch; the data migration settles the rest.
UPDATE `worklist` SET `batch` = 1 WHERE `seed` = 1;--> statement-breakpoint
UPDATE `worklist` SET `credibility` = `quality`;--> statement-breakpoint
ALTER TABLE `worklist` DROP COLUMN `seed`;--> statement-breakpoint
ALTER TABLE `worklist` DROP COLUMN `quality`;