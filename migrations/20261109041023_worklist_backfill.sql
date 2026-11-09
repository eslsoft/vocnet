-- Every entry gets its worklist row. An entry with a lease or a completion was claimed before;
-- the lease expiry or the completion time stands in for that claim time.
INSERT INTO `worklist` (`entry_id`, `created_at`, `live`, `claimed_at`, `lease_id`, `lease_holder`, `lease_expires_at`, `last_worked_at`, `last_worked_by`, `last_note`)
SELECT
	`entries`.`id`,
	`entries`.`created_at`,
	EXISTS (SELECT 1 FROM `facts` WHERE `facts`.`kind` = 'entry' AND `facts`.`subject_id` = `entries`.`id` AND `facts`.`status` IN ('pending', 'published')),
	COALESCE(`work_leases`.`expires_at`, `entry_work`.`last_worked_at`),
	`work_leases`.`id`,
	`work_leases`.`holder`,
	`work_leases`.`expires_at`,
	`entry_work`.`last_worked_at`,
	`entry_work`.`last_worked_by`,
	`entry_work`.`last_note`
FROM `entries`
LEFT JOIN `work_leases` ON `work_leases`.`entry_id` = `entries`.`id`
LEFT JOIN `entry_work` ON `entry_work`.`entry_id` = `entries`.`id`;
