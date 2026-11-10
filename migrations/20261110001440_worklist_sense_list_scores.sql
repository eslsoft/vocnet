-- The sense inventory slot now closes only when the entry's sense list names exactly its live
-- senses, and the per-sense slots count only senses outside that list's extra. So every entry is
-- rescored as `assessEntry` in server/domain/work.ts scores it, over every slot. Live means pending
-- or published; a sense is live while its gloss is. The entry's list is its live `sense_list` fact
-- that no live correction supersedes (`currentSenseList` in server/domain/sense-list.ts). It
-- settles the inventory when it names as many senses as are live and each of them is a live sense
-- of the entry: a list never names a sense twice. The per-sense needs are those of
-- worklist_usage_scores, and a relation counts only while its other sense can show, as
-- worklist_relation_ends_scores counts it. Quality and awaiting_review are unchanged: they count
-- live facts of any kind, which the scores backfill already does. The `sense_list` gap's `rejected`
-- count (MAX_SENSE_LIST_ATTEMPTS in server/domain/work.ts) enters only the open work, and the stall
-- below is lifted for every unsettled entry whatever that count, so it needs no column here.
WITH `glossed` AS MATERIALIZED (
	SELECT `senses`.`id`, `senses`.`entry_id`, `senses`.`pos`
	FROM `senses`
	WHERE EXISTS (
		SELECT 1 FROM `facts`
		WHERE `facts`.`subject_id` = `senses`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'sense'
	)
), `current_list` AS MATERIALIZED (
	SELECT `facts`.`subject_id` AS `entry_id`, `facts`.`payload`
	FROM `facts`
	WHERE `facts`.`kind` = 'sense_list' AND `facts`.`status` IN ('pending', 'published') AND NOT EXISTS (
		SELECT 1 FROM `facts` AS `correction`
		WHERE `correction`.`supersedes_id` = `facts`.`id` AND `correction`.`status` IN ('pending', 'published')
	)
), `extra` AS MATERIALIZED (
	SELECT `current_list`.`entry_id`, `item`.`value` AS `sense_id`
	FROM `current_list`, json_each(`current_list`.`payload`, '$.extra') AS `item`
), `listed` AS (
	SELECT `current_list`.`entry_id`, `item`.`value` AS `sense_id`
	FROM `current_list`, json_each(`current_list`.`payload`, '$.common') AS `item`
	UNION ALL
	SELECT `entry_id`, `sense_id` FROM `extra`
), `list_fill` AS (
	SELECT `listed`.`entry_id`, count(*) AS `listed`, count(`glossed`.`id`) AS `listed_live`
	FROM `listed` LEFT JOIN `glossed` ON `glossed`.`id` = `listed`.`sense_id` AND `glossed`.`entry_id` = `listed`.`entry_id`
	GROUP BY `listed`.`entry_id`
), `inventory` AS (
	SELECT `glossed`.`entry_id`, count(*) AS `senses`
	FROM `glossed`
	GROUP BY `glossed`.`entry_id`
), `live_sense` AS (
	SELECT `glossed`.`id`, `glossed`.`entry_id`,
		CASE `glossed`.`pos` WHEN 'noun' THEN 2 WHEN 'verb' THEN 2 WHEN 'adjective' THEN 2 WHEN 'adverb' THEN 1 ELSE 0 END AS `need`,
		`glossed`.`pos` IN ('noun', 'verb', 'adjective') AS `topics_need`,
		`glossed`.`pos` IN ('noun', 'verb') AS `grammar_need`,
		`glossed`.`pos` IN ('noun', 'verb', 'adjective') AS `collocations_need`
	FROM `glossed`
	WHERE NOT EXISTS (
		SELECT 1 FROM `extra` WHERE `extra`.`entry_id` = `glossed`.`entry_id` AND `extra`.`sense_id` = `glossed`.`id`
	)
), `sense_fill` AS (
	SELECT `live_sense`.`entry_id`, `live_sense`.`need`, `live_sense`.`topics_need`,
		`live_sense`.`grammar_need`, `live_sense`.`collocations_need`,
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
			+ max(0, `grammar_need` - `grammar`) + max(0, `collocations_need` - `collocation`)) AS `missing`
	FROM `sense_fill`
	GROUP BY `entry_id`
), `entry_work` AS (
	SELECT `worklist`.`entry_id`,
		`entries`.`lemma` NOT LIKE '% %' AS `single`,
		coalesce(`inventory`.`senses`, 0) > 0 AS `has_senses`,
		coalesce(`inventory`.`senses`, 0) > 0 AND `list_fill`.`listed` = `inventory`.`senses`
			AND `list_fill`.`listed_live` = `inventory`.`senses` AS `settled`,
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
	FROM `worklist`
	JOIN `entries` ON `entries`.`id` = `worklist`.`entry_id`
	LEFT JOIN `inventory` ON `inventory`.`entry_id` = `worklist`.`entry_id`
	LEFT JOIN `list_fill` ON `list_fill`.`entry_id` = `worklist`.`entry_id`
)
UPDATE `worklist`
SET `completeness` = 1.0 - CAST(
		(NOT coalesce(`entry_work`.`settled`, 0)) + `entry_work`.`missing` + coalesce(`sense_work`.`missing`, 0) AS REAL
	) / (3 + `entry_work`.`single` + coalesce(`sense_work`.`slots`, 0)),
	-- No claim recorded before this release named a sense_list gap, so an entry with senses whose
	-- list does not settle them has open work its claim did not find, and the stall is lifted, as
	-- `isStalled` lifts it.
	`stalled` = `worklist`.`stalled` AND NOT (`entry_work`.`has_senses` AND NOT coalesce(`entry_work`.`settled`, 0))
FROM `entry_work` LEFT JOIN `sense_work` ON `sense_work`.`entry_id` = `entry_work`.`entry_id`
WHERE `entry_work`.`entry_id` = `worklist`.`entry_id`;
