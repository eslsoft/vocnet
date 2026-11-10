CREATE TABLE `public_hypernyms` (
	`broader_sense_id` text NOT NULL,
	`sense_id` text NOT NULL,
	`domain` text,
	`entry_id` text NOT NULL,
	`lemma` text NOT NULL,
	`summary` text NOT NULL,
	PRIMARY KEY(`broader_sense_id`, `sense_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_hypernyms_sense_idx` ON `public_hypernyms` (`sense_id`);--> statement-breakpoint
CREATE INDEX `public_hypernyms_entry_idx` ON `public_hypernyms` (`entry_id`);--> statement-breakpoint
CREATE TABLE `work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`subject_id` text NOT NULL,
	`gap` text NOT NULL,
	`stage` integer NOT NULL,
	`rank` integer NOT NULL,
	`zipf_order` real NOT NULL,
	`awaiting` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`worked` integer DEFAULT false NOT NULL,
	`claimed_gap` text,
	`lease_id` text,
	`lease_holder` text,
	`lease_expires_at` text,
	`last_worked_at` text,
	`last_worked_by` text,
	`last_note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_items_lease_whole" CHECK(("work_items"."lease_id" is null) = ("work_items"."lease_holder" is null) and ("work_items"."lease_id" is null) = ("work_items"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_items_subject_idx` ON `work_items` (`type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `work_items_entry_idx` ON `work_items` (`entry_id`);--> statement-breakpoint
CREATE INDEX `work_items_lease_idx` ON `work_items` (`lease_id`) WHERE lease_id is not null;--> statement-breakpoint
CREATE INDEX `work_items_queue_idx` ON `work_items` (`rank`,"zipf_order" desc,`created_at`,`id`) WHERE awaiting = 0 and attempts < 3;--> statement-breakpoint
CREATE INDEX `work_items_type_queue_idx` ON `work_items` (`type`,`rank`,"zipf_order" desc,`created_at`,`id`) WHERE awaiting = 0 and attempts < 3;--> statement-breakpoint
CREATE INDEX `work_items_curation_idx` ON `work_items` (`rank`,"zipf_order" desc,`created_at`,`id`) WHERE attempts >= 3;--> statement-breakpoint
CREATE TABLE `work_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`type` text NOT NULL,
	`entry_ids` text NOT NULL,
	`item_ids` text NOT NULL,
	`claimed_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_leases_expires_idx` ON `work_leases` (`expires_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_worklist` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`live` integer NOT NULL,
	`seed` integer DEFAULT false NOT NULL,
	`frequency_key` text,
	`level_rank` integer,
	`zipf` real,
	`completeness` real DEFAULT 0 NOT NULL,
	`quality` real DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`scored_revision` integer DEFAULT 0 NOT NULL,
	`view_revision` integer DEFAULT 0 NOT NULL,
	`last_worked_at` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_worklist`("entry_id", "created_at", "live", "seed", "frequency_key", "level_rank", "zipf", "completeness", "quality", "revision", "scored_revision", "view_revision", "last_worked_at") SELECT "entry_id", "created_at", "live", "seed", "frequency_key", "level_rank", "zipf", "completeness", "quality", "revision", "scored_revision", "view_revision", "last_worked_at" FROM `worklist`;--> statement-breakpoint
DROP TABLE `worklist`;--> statement-breakpoint
ALTER TABLE `__new_worklist` RENAME TO `worklist`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `worklist_stale_idx` ON `worklist` (`entry_id`) WHERE revision <> scored_revision;--> statement-breakpoint
CREATE INDEX `worklist_view_stale_idx` ON `worklist` (`entry_id`) WHERE revision <> view_revision;--> statement-breakpoint
DROP INDEX `public_sense_topics_entry_idx`;--> statement-breakpoint
ALTER TABLE `public_sense_topics` ADD `rare` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `public_sense_topics_entry_idx` ON `public_sense_topics` (`entry_id`,`rare`,`topic_id`);