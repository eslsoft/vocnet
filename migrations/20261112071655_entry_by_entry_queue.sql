DROP INDEX `work_items_queue_idx`;--> statement-breakpoint
DROP INDEX `work_items_type_queue_idx`;--> statement-breakpoint
CREATE INDEX `work_items_queue_idx` ON `work_items` (`rank`,"zipf_order" desc,`stage`,`created_at`,`id`) WHERE awaiting = 0 and attempts < 2;--> statement-breakpoint
CREATE INDEX `work_items_type_queue_idx` ON `work_items` (`type`,`rank`,"zipf_order" desc,`stage`,`created_at`,`id`) WHERE awaiting = 0 and attempts < 2;--> statement-breakpoint
-- Items rank by batch and band now, with the stage after the frequency: mark every row stale so the
-- rescore writes each entry's items again with the new rank.
UPDATE worklist SET revision = revision + 1;
