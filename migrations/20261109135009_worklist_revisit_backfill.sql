-- No pass has recorded whether it made progress yet, so every entry with an open gap, judged as
-- `entryGaps` in server/domain/work.ts judges it, gets one revisit. Its next completed pass then
-- decides. Live means pending or published.
UPDATE `worklist`
SET `revisit` = (
	NOT EXISTS (
		SELECT 1 FROM `senses` JOIN `facts` ON `facts`.`subject_id` = `senses`.`id`
		WHERE `senses`.`entry_id` = `worklist`.`entry_id` AND `facts`.`kind` = 'sense' AND `facts`.`status` IN ('pending', 'published')
	)
	OR NOT EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`kind` = 'form' AND `facts`.`status` IN ('pending', 'published')
	)
	OR NOT EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`kind` = 'pronunciation' AND `facts`.`status` IN ('pending', 'published')
	)
	OR EXISTS (
		SELECT 1 FROM `senses`
		WHERE `senses`.`entry_id` = `worklist`.`entry_id`
			AND EXISTS (
				SELECT 1 FROM `facts`
				WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'sense' AND `facts`.`status` IN ('pending', 'published')
			)
			AND (
				(SELECT count(*) FROM `facts` WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'relation' AND `facts`.`status` IN ('pending', 'published'))
					+ (SELECT count(*) FROM `facts` WHERE `facts`.`object_id` = `senses`.`id` AND `facts`.`kind` = 'relation' AND `facts`.`status` IN ('pending', 'published')) < 2
				OR NOT EXISTS (
					SELECT 1 FROM `facts`
					WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'example' AND `facts`.`status` IN ('pending', 'published')
				)
				OR NOT EXISTS (
					SELECT 1 FROM `facts`
					WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'translation' AND `facts`.`status` IN ('pending', 'published')
						AND (json_extract(`facts`.`payload`, '$.language') = 'zh' OR json_extract(`facts`.`payload`, '$.language') LIKE 'zh-%')
				)
			)
	)
);
