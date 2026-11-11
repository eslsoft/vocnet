-- Task history and slot counts (docs/design.md, The worklist and work item tables).
--
-- 1. Every open item gets its history row, opened when the item was; items closed before this
--    release left no trace, and no attempt before it recorded a verdict.
INSERT INTO `work_item_log` (`id`, `entry_id`, `type`, `subject_id`, `gap`, `created_at`, `closed_at`)
SELECT `id`, `entry_id`, `type`, `subject_id`, `gap`, `created_at`, NULL FROM `work_items`;
--> statement-breakpoint
-- 2. The slot counts are 0 until each row is rescored, so every row is stale. Drain it with
--    POST /manage/v1/work/rescore until `remaining` is 0, or let the cron drain it 100 a run.
UPDATE `worklist` SET `revision` = `revision` + 1;
