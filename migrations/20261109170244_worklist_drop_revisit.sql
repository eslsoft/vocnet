DROP INDEX `worklist_claim_order_idx`;--> statement-breakpoint
ALTER TABLE `worklist` DROP COLUMN `claim_rank`;--> statement-breakpoint
ALTER TABLE `worklist` DROP COLUMN `claim_count`;--> statement-breakpoint
ALTER TABLE `worklist` DROP COLUMN `revisit`;--> statement-breakpoint
ALTER TABLE `worklist` DROP COLUMN `revisit_streak`;