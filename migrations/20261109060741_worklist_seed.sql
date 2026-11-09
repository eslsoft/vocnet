DROP INDEX `worklist_claim_order_idx`;--> statement-breakpoint
ALTER TABLE `worklist` ADD `seed` integer DEFAULT false NOT NULL;