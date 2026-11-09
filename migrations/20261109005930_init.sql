CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_key_hash_unique` ON `agents` (`key_hash`);--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`lemma` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_lemma_unique` ON `entries` (`lemma`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`object_id` text,
	`content_key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`supersedes_id` text,
	`author` text NOT NULL,
	`review` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_live_content_idx` ON `facts` (`kind`,`content_key`,`subject_id`) WHERE status in ('pending', 'published');--> statement-breakpoint
CREATE INDEX `facts_subject_idx` ON `facts` (`subject_id`,`status`);--> statement-breakpoint
CREATE INDEX `facts_object_idx` ON `facts` (`object_id`);--> statement-breakpoint
CREATE INDEX `facts_status_created_idx` ON `facts` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `facts_status_updated_idx` ON `facts` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`message` text NOT NULL,
	`status` text NOT NULL,
	`assignee` text,
	`claim_expires_at` text,
	`resolution_note` text,
	`resolution_fact_ids` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_status_created_idx` ON `feedback` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `senses` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`pos` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senses_entry_idx` ON `senses` (`entry_id`);