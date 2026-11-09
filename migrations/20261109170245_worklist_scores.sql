ALTER TABLE `worklist` ADD `completeness` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `quality` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `stalled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `claimed_work` text;--> statement-breakpoint
ALTER TABLE `worklist` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `scored_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `worklist` ADD `claim_rank` integer GENERATED ALWAYS AS (case when live = 0 or (revision = scored_revision and (stalled = 1 or (completeness >= 1 and quality >= 1))) then null else 2 - 2 * seed + (claimed_at is not null) end) VIRTUAL;--> statement-breakpoint
CREATE INDEX `worklist_claim_order_idx` ON `worklist` (`claim_rank`,`completeness`,`claimed_at`,`created_at`,`entry_id`);--> statement-breakpoint
CREATE INDEX `worklist_stale_idx` ON `worklist` (`entry_id`) WHERE revision <> scored_revision;--> statement-breakpoint
CREATE INDEX `feedback_target_idx` ON `feedback` (`target_id`,`status`);