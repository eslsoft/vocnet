CREATE TABLE `public_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`lemma` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`built_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_entries_lemma_unique` ON `public_entries` (`lemma`);--> statement-breakpoint
CREATE TABLE `public_forms` (
	`content_key` text NOT NULL,
	`fact_id` text NOT NULL,
	`entry_id` text NOT NULL,
	PRIMARY KEY(`content_key`, `fact_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_forms_entry_idx` ON `public_forms` (`entry_id`);--> statement-breakpoint
CREATE TABLE `public_sense_topics` (
	`topic_id` text NOT NULL,
	`lemma` text NOT NULL,
	`sense_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`pos` text NOT NULL,
	`gloss` text NOT NULL,
	PRIMARY KEY(`topic_id`, `lemma`, `sense_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_sense_topics_entry_idx` ON `public_sense_topics` (`entry_id`);--> statement-breakpoint
ALTER TABLE `worklist` ADD `view_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `worklist_view_stale_idx` ON `worklist` (`entry_id`) WHERE revision <> view_revision;