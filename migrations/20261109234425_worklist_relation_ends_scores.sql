-- A relation now fills a relations gap only while the sense at its other end can show: that sense
-- has a live gloss and its entry a live entry fact. Every entry is rescored as `assessEntry` in
-- server/domain/work.ts scores it, over every slot, as the usage rescore did; only the relation
-- count changes. Live means pending or published. Quality and awaiting_review are unchanged: they
-- do not depend on the other end of a relation.
-- Each statement aggregates per entry once and reaches facts through facts_subject_idx or
-- facts_object_idx, so it never scans facts per worklist row.
WITH `live_sense` AS (
	SELECT `senses`.`id`, `senses`.`entry_id`,
		CASE `senses`.`pos` WHEN 'noun' THEN 2 WHEN 'verb' THEN 2 WHEN 'adjective' THEN 2 WHEN 'adverb' THEN 1 ELSE 0 END AS `need`,
		`senses`.`pos` IN ('noun', 'verb', 'adjective') AS `topics_need`,
		`senses`.`pos` IN ('noun', 'verb') AS `grammar_need`,
		`senses`.`pos` IN ('noun', 'verb', 'adjective') AS `collocations_need`
	FROM `senses`
	WHERE EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'sense'
	)
), `sense_fill` AS (
	SELECT `live_sense`.`entry_id`, `live_sense`.`need`, `live_sense`.`topics_need`,
		`live_sense`.`grammar_need`, `live_sense`.`collocations_need`,
		-- What the previous rescores counted, so a stall on the old relations gap can be lifted.
		(SELECT count(*) FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'relation')
		+ (SELECT count(*) FROM `facts`
			WHERE `facts`.`object_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'relation') AS `counted`,
		(SELECT count(*) FROM `facts` AS `relation`
			WHERE `relation`.`subject_id` = `live_sense`.`id` AND `relation`.`status` IN ('pending', 'published') AND `relation`.`kind` = 'relation'
				AND EXISTS (
					SELECT 1 FROM `senses` AS `other`
					WHERE `other`.`id` = `relation`.`object_id`
						AND EXISTS (SELECT 1 FROM `facts`
							WHERE `facts`.`subject_id` = `other`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'sense')
						AND EXISTS (SELECT 1 FROM `facts`
							WHERE `facts`.`subject_id` = `other`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'entry')
				))
		+ (SELECT count(*) FROM `facts` AS `relation`
			WHERE `relation`.`object_id` = `live_sense`.`id` AND `relation`.`status` IN ('pending', 'published') AND `relation`.`kind` = 'relation'
				AND EXISTS (
					SELECT 1 FROM `senses` AS `other`
					WHERE `other`.`id` = `relation`.`subject_id`
						AND EXISTS (SELECT 1 FROM `facts`
							WHERE `facts`.`subject_id` = `other`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'sense')
						AND EXISTS (SELECT 1 FROM `facts`
							WHERE `facts`.`subject_id` = `other`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'entry')
				)) AS `relations`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'example') AS `example`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'translation'
				AND (json_extract(`facts`.`payload`, '$.language') = 'zh' OR json_extract(`facts`.`payload`, '$.language') LIKE 'zh-%')) AS `translation`,
		(SELECT count(*) FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'topic') AS `topics`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'grammar') AS `grammar`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'collocation') AS `collocation`
	FROM `live_sense`
), `sense_work` AS (
	SELECT `entry_id`,
		sum(`need` + 2 + `topics_need` + `grammar_need` + `collocations_need`) AS `slots`,
		sum(max(0, `need` - `relations`) + (NOT `example`) + (NOT `translation`) + max(0, `topics_need` - `topics`)
			+ max(0, `grammar_need` - `grammar`) + max(0, `collocations_need` - `collocation`)) AS `missing`,
		-- A sense's relations gap differs from the one the previous rescores named exactly when it
		-- is open now and its count changed, since the new count is never above the old.
		sum(`relations` < `need` AND `relations` <> `counted`) AS `changed`
	FROM `sense_fill`
	GROUP BY `entry_id`
), `entry_work` AS (
	SELECT `worklist`.`entry_id`,
		`entries`.`lemma` NOT LIKE '% %' AS `single`,
		(`entries`.`lemma` NOT LIKE '% %' AND NOT EXISTS (
			SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'morphology'
		))
		+ (NOT EXISTS (
			SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'form'
		))
		+ (NOT EXISTS (
			SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'pronunciation'
		)) AS `missing`
	FROM `worklist` JOIN `entries` ON `entries`.`id` = `worklist`.`entry_id`
)
UPDATE `worklist`
SET `completeness` = 1.0 - CAST(
		(`sense_work`.`entry_id` IS NULL) + `entry_work`.`missing` + coalesce(`sense_work`.`missing`, 0) AS REAL
	) / (3 + `entry_work`.`single` + coalesce(`sense_work`.`slots`, 0)),
	-- A changed relations gap changes the open work, so it lifts the stall as `isStalled` does.
	`stalled` = `worklist`.`stalled` AND coalesce(`sense_work`.`changed`, 0) = 0
FROM `entry_work` LEFT JOIN `sense_work` ON `sense_work`.`entry_id` = `entry_work`.`entry_id`
WHERE `entry_work`.`entry_id` = `worklist`.`entry_id`;
