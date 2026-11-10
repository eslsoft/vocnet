-- The view tables hold derived rows only and were emptied by public_api_v2_clear, so the changed
-- ones are recreated rather than altered: SQLite cannot add a NOT NULL column without a default.
DROP TABLE `public_forms`;--> statement-breakpoint
DROP TABLE `public_sense_topics`;--> statement-breakpoint
DROP TABLE `public_entries`;--> statement-breakpoint
CREATE TABLE `public_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`lemma` text NOT NULL,
	`document` text NOT NULL,
	`digest` text NOT NULL,
	`summary` text NOT NULL,
	`built_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_entries_lemma_unique` ON `public_entries` (`lemma`);--> statement-breakpoint
CREATE TABLE `public_forms` (
	`content_key` text NOT NULL,
	`entry_id` text NOT NULL,
	`type` text NOT NULL,
	`pos` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_forms_content_key_idx` ON `public_forms` (`content_key`);--> statement-breakpoint
CREATE INDEX `public_forms_entry_idx` ON `public_forms` (`entry_id`);--> statement-breakpoint
CREATE TABLE `public_sense_topics` (
	`topic_id` text NOT NULL,
	`lemma` text NOT NULL,
	`sense_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`summary` text NOT NULL,
	PRIMARY KEY(`topic_id`, `lemma`, `sense_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_sense_topics_entry_idx` ON `public_sense_topics` (`entry_id`);--> statement-breakpoint
CREATE TABLE `public_phrase_words` (
	`word` text NOT NULL,
	`entry_id` text NOT NULL,
	PRIMARY KEY(`word`, `entry_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_phrase_words_entry_idx` ON `public_phrase_words` (`entry_id`);--> statement-breakpoint
CREATE TABLE `public_morphemes` (
	`form` text NOT NULL,
	`role` text NOT NULL,
	`entry_id` text NOT NULL,
	PRIMARY KEY(`form`, `role`, `entry_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `public_morphemes_entry_idx` ON `public_morphemes` (`entry_id`);
