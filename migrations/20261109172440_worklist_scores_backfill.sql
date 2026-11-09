-- Scores every entry from its current facts as `assessEntry` in server/domain/work.ts scores it.
-- Live means pending or published. The relations each sense needs come from `RELATIONS_NEEDED`.
-- Each statement aggregates per entry once and reaches facts through facts_subject_idx,
-- facts_object_idx, or the pending status, so it never scans facts per worklist row.
-- No row is stalled: no pass has recorded the open work its claim found yet.
WITH `live_sense` AS (
	SELECT `senses`.`id`, `senses`.`entry_id`,
		CASE `senses`.`pos` WHEN 'noun' THEN 2 WHEN 'verb' THEN 2 WHEN 'adjective' THEN 2 WHEN 'adverb' THEN 1 ELSE 0 END AS `need`
	FROM `senses`
	WHERE EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'sense'
	)
), `sense_fill` AS (
	SELECT `live_sense`.`entry_id`, `live_sense`.`need`,
		(SELECT count(*) FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'relation')
		+ (SELECT count(*) FROM `facts`
			WHERE `facts`.`object_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'relation') AS `relations`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'example') AS `example`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'translation'
				AND (json_extract(`facts`.`payload`, '$.language') = 'zh' OR json_extract(`facts`.`payload`, '$.language') LIKE 'zh-%')) AS `translation`
	FROM `live_sense`
), `sense_work` AS (
	SELECT `entry_id`, sum(`need` + 2) AS `slots`, sum(max(0, `need` - `relations`) + (NOT `example`) + (NOT `translation`)) AS `missing`
	FROM `sense_fill`
	GROUP BY `entry_id`
)
UPDATE `worklist`
SET `completeness` = 1.0 - CAST(
	(`sense_work`.`entry_id` IS NULL)
	+ (NOT EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `w`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'form'
	))
	+ (NOT EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `w`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'pronunciation'
	))
	+ coalesce(`sense_work`.`missing`, 0) AS REAL
) / (3 + coalesce(`sense_work`.`slots`, 0))
FROM `worklist` AS `w` LEFT JOIN `sense_work` ON `sense_work`.`entry_id` = `w`.`entry_id`
WHERE `w`.`entry_id` = `worklist`.`entry_id`;
--> statement-breakpoint
-- A weak fact is live and either the target of open or claimed feedback or published on an
-- uncertain verdict; quality counts the live facts about the entry and its senses.
WITH `about` AS (
	SELECT `facts`.`subject_id` AS `entry_id`, `facts`.`id`, `facts`.`status`, `facts`.`review`
	FROM `worklist` JOIN `facts` ON `facts`.`subject_id` = `worklist`.`entry_id`
	WHERE `facts`.`status` IN ('pending', 'published')
	UNION ALL
	SELECT `senses`.`entry_id`, `facts`.`id`, `facts`.`status`, `facts`.`review`
	FROM `senses` JOIN `facts` ON `facts`.`subject_id` = `senses`.`id`
	WHERE `facts`.`status` IN ('pending', 'published')
), `scored` AS (
	SELECT `entry_id`, count(*) AS `live`, sum(
		EXISTS (
			SELECT 1 FROM `feedback`
			WHERE `feedback`.`target_id` = `about`.`id` AND `feedback`.`status` IN ('open', 'claimed') AND `feedback`.`target_type` = 'fact'
		)
		OR (`about`.`status` = 'published' AND json_extract(`about`.`review`, '$.verdict') = 'uncertain')
	) AS `weak`
	FROM `about`
	GROUP BY `entry_id`
)
UPDATE `worklist`
SET `quality` = coalesce(1.0 - CAST(`scored`.`weak` AS REAL) / `scored`.`live`, 1.0)
FROM `worklist` AS `w` LEFT JOIN `scored` ON `scored`.`entry_id` = `w`.`entry_id`
WHERE `w`.`entry_id` = `worklist`.`entry_id`;
--> statement-breakpoint
-- A pending fact about the entry or its senses, or a pending relation into one of its senses,
-- keeps the entry out of claims until its review settles.
UPDATE `worklist`
SET `awaiting_review` = `entry_id` IN (
	SELECT `facts`.`subject_id` FROM `facts` WHERE `facts`.`status` = 'pending'
	UNION ALL
	SELECT `senses`.`entry_id` FROM `facts` JOIN `senses` ON `senses`.`id` = `facts`.`subject_id` WHERE `facts`.`status` = 'pending'
	UNION ALL
	SELECT `senses`.`entry_id` FROM `facts` JOIN `senses` ON `senses`.`id` = `facts`.`object_id`
	WHERE `facts`.`status` = 'pending' AND `facts`.`kind` = 'relation'
);
