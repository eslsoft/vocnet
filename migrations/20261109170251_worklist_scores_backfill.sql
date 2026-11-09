-- Scores every entry from its current facts as `assessEntry` in server/domain/work.ts scores it.
-- Live means pending or published. The relations each sense needs come from `RELATIONS_NEEDED`.
-- No row is stalled: no pass has recorded the open work its claim found yet.
UPDATE `worklist`
SET `completeness` = 1.0 - CAST(
	(NOT EXISTS (
		SELECT 1 FROM `senses` JOIN `facts` ON `facts`.`subject_id` = `senses`.`id`
		WHERE `senses`.`entry_id` = `worklist`.`entry_id` AND `facts`.`kind` = 'sense' AND `facts`.`status` IN ('pending', 'published')
	))
	+ (NOT EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`kind` = 'form' AND `facts`.`status` IN ('pending', 'published')
	))
	+ (NOT EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`kind` = 'pronunciation' AND `facts`.`status` IN ('pending', 'published')
	))
	+ coalesce((
		SELECT sum(
			max(0,
				(CASE `senses`.`pos` WHEN 'noun' THEN 2 WHEN 'verb' THEN 2 WHEN 'adjective' THEN 2 WHEN 'adverb' THEN 1 ELSE 0 END)
				- (SELECT count(*) FROM `facts` WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'relation' AND `facts`.`status` IN ('pending', 'published'))
				- (SELECT count(*) FROM `facts` WHERE `facts`.`object_id` = `senses`.`id` AND `facts`.`kind` = 'relation' AND `facts`.`status` IN ('pending', 'published'))
			)
			+ (NOT EXISTS (
				SELECT 1 FROM `facts`
				WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'example' AND `facts`.`status` IN ('pending', 'published')
			))
			+ (NOT EXISTS (
				SELECT 1 FROM `facts`
				WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'translation' AND `facts`.`status` IN ('pending', 'published')
					AND (json_extract(`facts`.`payload`, '$.language') = 'zh' OR json_extract(`facts`.`payload`, '$.language') LIKE 'zh-%')
			))
		)
		FROM `senses`
		WHERE `senses`.`entry_id` = `worklist`.`entry_id`
			AND EXISTS (
				SELECT 1 FROM `facts`
				WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'sense' AND `facts`.`status` IN ('pending', 'published')
			)
	), 0) AS REAL
) / (3 + coalesce((
	SELECT sum((CASE `senses`.`pos` WHEN 'noun' THEN 2 WHEN 'verb' THEN 2 WHEN 'adjective' THEN 2 WHEN 'adverb' THEN 1 ELSE 0 END) + 2)
	FROM `senses`
	WHERE `senses`.`entry_id` = `worklist`.`entry_id`
		AND EXISTS (
			SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`kind` = 'sense' AND `facts`.`status` IN ('pending', 'published')
		)
), 0));
--> statement-breakpoint
-- A weak fact is live and either the target of open or claimed feedback or published on an
-- uncertain verdict; quality counts the facts about the entry and its senses.
UPDATE `worklist`
SET `quality` = coalesce((
	SELECT 1.0 - CAST(sum(
		EXISTS (
			SELECT 1 FROM `feedback`
			WHERE `feedback`.`target_id` = `facts`.`id` AND `feedback`.`target_type` = 'fact' AND `feedback`.`status` IN ('open', 'claimed')
		)
		OR (`facts`.`status` = 'published' AND json_extract(`facts`.`review`, '$.verdict') = 'uncertain')
	) AS REAL) / count(*)
	FROM `facts`
	WHERE `facts`.`status` IN ('pending', 'published')
		AND (
			`facts`.`subject_id` = `worklist`.`entry_id`
			OR `facts`.`subject_id` IN (SELECT `senses`.`id` FROM `senses` WHERE `senses`.`entry_id` = `worklist`.`entry_id`)
		)
	HAVING count(*) > 0
), 1.0);
