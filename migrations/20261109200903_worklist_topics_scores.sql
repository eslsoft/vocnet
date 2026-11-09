-- Topics gaps open on every noun, verb, and adjective sense, so every entry is rescored as
-- `assessEntry` in server/domain/work.ts scores it. Live means pending or published. The
-- relations and topics each sense needs come from `RELATIONS_NEEDED` and `TOPICS_NEEDED`.
-- Each statement aggregates per entry once and reaches facts through facts_subject_idx or
-- facts_object_idx, so it never scans facts per worklist row.
WITH `live_sense` AS (
	SELECT `senses`.`id`, `senses`.`entry_id`,
		CASE `senses`.`pos` WHEN 'noun' THEN 2 WHEN 'verb' THEN 2 WHEN 'adjective' THEN 2 WHEN 'adverb' THEN 1 ELSE 0 END AS `need`,
		CASE WHEN `senses`.`pos` IN ('noun', 'verb', 'adjective') THEN 1 ELSE 0 END AS `topics_need`
	FROM `senses`
	WHERE EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'sense'
	)
), `sense_fill` AS (
	SELECT `live_sense`.`entry_id`, `live_sense`.`need`, `live_sense`.`topics_need`,
		(SELECT count(*) FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'relation')
		+ (SELECT count(*) FROM `facts`
			WHERE `facts`.`object_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'relation') AS `relations`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'example') AS `example`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'translation'
				AND (json_extract(`facts`.`payload`, '$.language') = 'zh' OR json_extract(`facts`.`payload`, '$.language') LIKE 'zh-%')) AS `translation`,
		(SELECT count(*) FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'topic') AS `topics`
	FROM `live_sense`
), `sense_work` AS (
	SELECT `entry_id`,
		sum(`need` + 2 + `topics_need`) AS `slots`,
		sum(max(0, `need` - `relations`) + (NOT `example`) + (NOT `translation`) + max(0, `topics_need` - `topics`)) AS `missing`,
		max(`topics` < `topics_need`) AS `topics_open`
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
) / (3 + coalesce(`sense_work`.`slots`, 0)),
	-- A topics gap is open work no claim recorded before this release, so the stall it would have
	-- kept is lifted, as `isStalled` lifts it when the open work changes.
	`stalled` = `w`.`stalled` AND NOT (
		coalesce(`sense_work`.`topics_open`, 0) AND coalesce(`w`.`claimed_work`, '') NOT LIKE '%"type":"topics"%'
	)
FROM `worklist` AS `w` LEFT JOIN `sense_work` ON `sense_work`.`entry_id` = `w`.`entry_id`
WHERE `w`.`entry_id` = `worklist`.`entry_id`;
