CREATE TABLE `lemma_cefr` (
	`lemma` text NOT NULL,
	`pos` text NOT NULL,
	`level` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`lemma`, `pos`),
	FOREIGN KEY (`source_id`) REFERENCES `reference_sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lemma_cefr_level" CHECK("lemma_cefr"."level" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'))
);
--> statement-breakpoint
CREATE TABLE `reference_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`license` text NOT NULL,
	`license_url` text NOT NULL,
	`changes` text NOT NULL,
	`attribution` text NOT NULL,
	`url` text NOT NULL,
	`retrieved_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word_frequency` (
	`word` text PRIMARY KEY NOT NULL,
	`zipf` real NOT NULL,
	`rank` integer NOT NULL,
	`source_id` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `reference_sources`(`id`) ON UPDATE no action ON DELETE no action
);
