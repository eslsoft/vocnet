CREATE TABLE `sentences` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`text_key` text NOT NULL,
	`source` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sentences_text_key_unique` ON `sentences` (`text_key`);