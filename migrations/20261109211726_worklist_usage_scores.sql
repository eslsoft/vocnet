-- Grammar, collocations, and word formation gaps open on existing entries, so every entry is
-- rescored as `assessEntry` in server/domain/work.ts scores it, over every slot. Live means pending
-- or published. Per sense, the relations come from `RELATIONS_NEEDED`, the topics from
-- `TOPICS_NEEDED`, the grammar from `GRAMMAR_NEEDED` (noun and verb), and the collocations from
-- `COLLOCATIONS_NEEDED` (noun, verb, and adjective). A single-word entry, one whose lemma has no
-- space, needs a word formation. Quality and awaiting_review are unchanged: they count live facts
-- of any kind, and no fact of the new kinds existed before.
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
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'topic') AS `topics`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'grammar') AS `grammar`,
		EXISTS (SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `live_sense`.`id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'collocation') AS `collocation`
	FROM `live_sense`
), `sense_work` AS (
	SELECT `entry_id`,
		sum(`need` + 2 + `topics_need` + `grammar_need` + `collocations_need`) AS `slots`,
		sum(max(0, `need` - `relations`) + (NOT `example`) + (NOT `translation`) + max(0, `topics_need` - `topics`)) AS `missing`,
		sum(max(0, `grammar_need` - `grammar`) + max(0, `collocations_need` - `collocation`)) AS `usage_missing`
	FROM `sense_fill`
	GROUP BY `entry_id`
), `entry_work` AS (
	SELECT `worklist`.`entry_id`,
		`entries`.`lemma` NOT LIKE '% %' AS `single`,
		`entries`.`lemma` NOT LIKE '% %' AND NOT EXISTS (
			SELECT 1 FROM `facts`
			WHERE `facts`.`subject_id` = `worklist`.`entry_id` AND `facts`.`status` IN ('pending', 'published') AND `facts`.`kind` = 'morphology'
		) AS `morphology_missing`,
		(NOT EXISTS (
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
		(`sense_work`.`entry_id` IS NULL) + `entry_work`.`missing` + `entry_work`.`morphology_missing`
		+ coalesce(`sense_work`.`missing`, 0) + coalesce(`sense_work`.`usage_missing`, 0) AS REAL
	) / (3 + `entry_work`.`single` + coalesce(`sense_work`.`slots`, 0)),
	-- No claim recorded before this release named a grammar, collocations, or morphology gap, so
	-- any of them open makes the open work differ from the claim's and the stall is lifted, as
	-- `isStalled` lifts it and as the topics rescore lifted stalls for topics gaps.
	`stalled` = `worklist`.`stalled` AND `entry_work`.`morphology_missing` + coalesce(`sense_work`.`usage_missing`, 0) = 0
FROM `entry_work` LEFT JOIN `sense_work` ON `sense_work`.`entry_id` = `entry_work`.`entry_id`
WHERE `entry_work`.`entry_id` = `worklist`.`entry_id`;
