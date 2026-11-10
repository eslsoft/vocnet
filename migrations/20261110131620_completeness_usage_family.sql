-- The completeness rules ask for what a learner's dictionary gives a word (docs/design.md, Gaps):
-- three phrasal verbs headed by an A1-A2 verb, a word family linked by morphology base lemmas,
-- grammar and collocations for function words and adverbs, a translation for every example, and
-- region and register labels judged on every sense. This migration brings the stored facts to the
-- new rules, marks for review in place what the new rubrics judge differently, then leaves every
-- worklist row to rescore.
--
-- 1. A base part names the entry it is (`lemma`). Every live morphology base part without one whose
--    form is exactly the lemma of another live entry gains that lemma, and the fact is rewritten
--    with the content key the registry computes (`role:form|meaning|=lemma`, parts joined by +).
--    The scratch table lives only inside this migration.
CREATE TABLE `_morphology_bases` (`id` text PRIMARY KEY NOT NULL, `payload` text NOT NULL, `content_key` text NOT NULL);--> statement-breakpoint
INSERT INTO `_morphology_bases` (`id`, `payload`, `content_key`)
WITH `named` AS (
	SELECT `facts`.`id`, `part`.`key` AS `at`, `part`.`value` AS `value`,
		CASE WHEN json_extract(`part`.`value`, '$.role') = 'base' AND json_extract(`part`.`value`, '$.lemma') IS NULL
			AND EXISTS (
				SELECT 1 FROM `entries`
				WHERE `entries`.`lemma` = json_extract(`part`.`value`, '$.form') AND `entries`.`id` <> `facts`.`subject_id`
					AND EXISTS (SELECT 1 FROM `facts` AS `entry_fact` WHERE `entry_fact`.`kind` = 'entry' AND `entry_fact`.`subject_id` = `entries`.`id` AND `entry_fact`.`status` IN ('pending', 'published'))
			)
		THEN json_extract(`part`.`value`, '$.form') END AS `lemma`
	FROM `facts`, json_each(`facts`.`payload`, '$.parts') AS `part`
	WHERE `facts`.`kind` = 'morphology' AND `facts`.`status` IN ('pending', 'published')
),
`rebuilt` AS (
	SELECT `id`, `at`,
		CASE WHEN `lemma` IS NULL THEN json(`value`) ELSE json_set(`value`, '$.lemma', `lemma`) END AS `part`,
		json_extract(`value`, '$.role') || ':' || lower(trim(json_extract(`value`, '$.form')))
			|| coalesce('|' || lower(trim(json_extract(`value`, '$.meaning'))), '')
			|| coalesce('|=' || coalesce(json_extract(`value`, '$.lemma'), `lemma`), '') AS `key`,
		`lemma` IS NOT NULL AS `changed`
	FROM `named`
)
SELECT `id`, json_object('parts', json_group_array(json(`part`))), group_concat(`key`, '+')
FROM (SELECT * FROM `rebuilt` ORDER BY `id`, `at`)
GROUP BY `id`
HAVING max(`changed`) = 1;--> statement-breakpoint
UPDATE `facts`
SET `payload` = `_morphology_bases`.`payload`, `content_key` = `_morphology_bases`.`content_key`,
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `_morphology_bases`
WHERE `facts`.`id` = `_morphology_bases`.`id` AND `facts`.`status` IN ('pending', 'published');--> statement-breakpoint
DROP TABLE `_morphology_bases`;--> statement-breakpoint
-- 2. The morphology rubric now requires the present-day base the meaning comes from ("student" is
--    study + -ent, not stud + -ent) and judges a base's lemma: every published word formation of
--    more than one part is judged again in place. Each mark predates the reconcile cutoff so its
--    next runs enqueue them (500 per run); a fail invalidates the fact and reopens the gap.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'morphology' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND json_array_length(`payload`, '$.parts') > 1;--> statement-breakpoint
-- 3. A synonym never links two spellings of one word (practise and practice): a live synonym whose
--    ends' entries are a live spelling variant of one another is retracted, as a submission of one
--    is now refused.
UPDATE `facts`
SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `revalidate_since` = NULL
WHERE `id` IN (
	WITH `pairs` AS (
		SELECT `variant`.`subject_id` AS `main`, `entries`.`id` AS `spelling`
		FROM `facts` AS `variant`
		JOIN `entries` ON `entries`.`lemma` = json_extract(`variant`.`payload`, '$.form')
		WHERE `variant`.`kind` = 'form' AND `variant`.`status` IN ('pending', 'published')
			AND json_extract(`variant`.`payload`, '$.type') = 'variant'
	),
	`ends` AS (
		SELECT `main` AS `source_entry`, `spelling` AS `target_entry` FROM `pairs`
		UNION SELECT `spelling`, `main` FROM `pairs`
	)
	SELECT `relation`.`id`
	FROM `ends`
	JOIN `senses` AS `source` ON `source`.`entry_id` = `ends`.`source_entry`
	JOIN `facts` AS `relation` ON `relation`.`subject_id` = `source`.`id` AND `relation`.`status` IN ('pending', 'published')
	JOIN `senses` AS `target` ON `target`.`id` = `relation`.`object_id` AND `target`.`entry_id` = `ends`.`target_entry`
	WHERE `relation`.`kind` = 'relation' AND json_extract(`relation`.`payload`, '$.type') = 'synonym'
);--> statement-breakpoint
-- 4. A verb now needs three phrasal verbs, and a phrases closure must name the ones that exist:
--    every published phrases closure is judged again in place.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'gap_closure' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND json_extract(`payload`, '$.gap') = 'phrases';--> statement-breakpoint
-- 5. The sense review fails a sense used only in one variety of English with no region, and one
--    used only in a formal, literary, dated, or ironic register with no register. Every published
--    gloss of a common sense (none in the extra of a published sense list) of an A1 or A2 entry is
--    judged again in place, unless a live correction supersedes it. A gloss that fails stays
--    published as a weak fact (`revalidationFailure: flag`), and its producer corrects its labels.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'sense' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND `subject_id` IN (
		SELECT `senses`.`id` FROM `worklist`
		JOIN `senses` ON `senses`.`entry_id` = `worklist`.`entry_id`
		WHERE `worklist`.`level_rank` <= 2
			AND NOT EXISTS (
				SELECT 1 FROM `facts` AS `list`, json_each(`list`.`payload`, '$.extra') AS `extra`
				WHERE `list`.`kind` = 'sense_list' AND `list`.`subject_id` = `senses`.`entry_id` AND `list`.`status` = 'published'
					AND `extra`.`value` = `senses`.`id`
			)
	)
	AND NOT EXISTS (
		SELECT 1 FROM `facts` AS `correction`
		WHERE `correction`.`supersedes_id` = `facts`.`id` AND `correction`.`status` IN ('pending', 'published')
	);--> statement-breakpoint
-- 6. The sense list rubric now orders senses by commonness for a learner across parts of speech
--    and puts legal, technical, and other-variety senses in extra: every published sense list of
--    an A1 or A2 entry is judged again in place; a fail invalidates it and reopens the gap.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'sense_list' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND `subject_id` IN (SELECT `entry_id` FROM `worklist` WHERE `level_rank` <= 2);--> statement-breakpoint
-- 7. Every row is stale: the gap rules changed for every entry, and the public document gains a
--    morphology base's lemma and the word family it links. A stale row stays claimable and a stale
--    view is rebuilt on read; drain the rest with POST /manage/v1/work/rescore and
--    POST /manage/v1/public/rebuild.
UPDATE `worklist` SET `revision` = `revision` + 1;
