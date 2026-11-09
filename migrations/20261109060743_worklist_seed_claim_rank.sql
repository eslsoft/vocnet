ALTER TABLE `worklist` DROP COLUMN `claim_rank`;--> statement-breakpoint
ALTER TABLE `worklist` ADD `claim_rank` integer GENERATED ALWAYS AS (case claim_count when 1 then 0 when 0 then 2 - seed else 3 end) VIRTUAL;--> statement-breakpoint
CREATE INDEX `worklist_claim_order_idx` ON `worklist` (`live`,`claim_rank`,`claimed_at`,`created_at`,`entry_id`);