-- The view tables hold derived rows only and were emptied by public_view_v3_clear, so the changed
-- ones are recreated rather than altered: SQLite cannot add a NOT NULL column without a default.
CREATE TABLE `public_meanings` (
	`entry_id` text NOT NULL,
	`pos` text NOT NULL,
	`cefr` text,
	PRIMARY KEY(`entry_id`, `pos`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `public_search` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` text NOT NULL,
	`field` text NOT NULL,
	`scope` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_search_entry_idx` ON `public_search` (`entry_id`);--> statement-breakpoint
DROP TABLE `public_forms`;--> statement-breakpoint
DROP TABLE `public_sense_topics`;--> statement-breakpoint
DROP TABLE `public_entries`;--> statement-breakpoint
CREATE TABLE `public_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`lemma` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`summary` text NOT NULL,
	`frequency_order` integer NOT NULL,
	`built_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_entries_lemma_unique` ON `public_entries` (`lemma`);--> statement-breakpoint
CREATE INDEX `public_entries_frequency_idx` ON `public_entries` (`frequency_order`,`lemma`);--> statement-breakpoint
CREATE TABLE `public_forms` (
	`form` text NOT NULL,
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`pos` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_forms_form_idx` ON `public_forms` (`form`);--> statement-breakpoint
CREATE INDEX `public_forms_entry_idx` ON `public_forms` (`entry_id`);--> statement-breakpoint
CREATE TABLE `public_sense_topics` (
	`topic_id` text NOT NULL,
	`lemma` text NOT NULL,
	`sense_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`pos` text NOT NULL,
	`cefr` text,
	`level_order` integer NOT NULL,
	`frequency_order` integer NOT NULL,
	`summary` text NOT NULL,
	PRIMARY KEY(`topic_id`, `lemma`, `sense_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_sense_topics_frequency_idx` ON `public_sense_topics` (`topic_id`,`frequency_order`,`lemma`,`sense_id`);--> statement-breakpoint
CREATE INDEX `public_sense_topics_level_idx` ON `public_sense_topics` (`topic_id`,`level_order`,`lemma`,`sense_id`);--> statement-breakpoint
CREATE INDEX `public_sense_topics_entry_idx` ON `public_sense_topics` (`entry_id`,`topic_id`);