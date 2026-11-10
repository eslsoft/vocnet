-- The completeness rules changed (docs/design.md, Gaps): per-POS form paradigms, both accents,
-- adjective grammar, manner-adverb collocations, two examples for A1-A2 senses, a phrases gap for
-- A1-A2 verbs, no adjective topics, and gap closures. The write rules got stricter too. This
-- migration brings the stored facts to the new rules, then leaves every worklist row to rescore.
--
-- 1. Orphans: the live facts of a sense whose gloss was retracted and that has no live gloss, as
--    subject or as a relation's object. No read shows them; retracting them keeps them out of
--    every count.
UPDATE `facts`
SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `revalidate_since` = NULL
WHERE `status` IN ('pending', 'published') AND `kind` <> 'sense' AND (
	`subject_id` IN (
		SELECT `senses`.`id` FROM `senses`
		WHERE EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` = 'retracted')
			AND NOT EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published'))
	)
	OR `object_id` IN (
		SELECT `senses`.`id` FROM `senses`
		WHERE EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` = 'retracted')
			AND NOT EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published'))
	)
);--> statement-breakpoint
-- 2. Periphrastic comparisons are not forms (`isPeriphrastic`): a live comparative spelled
--    "more …" or superlative spelled "most …" is retracted, as a submission of one is now refused.
UPDATE `facts`
SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `revalidate_since` = NULL
WHERE `kind` = 'form' AND `status` IN ('pending', 'published') AND (
	(json_extract(`payload`, '$.type') = 'comparative' AND json_extract(`payload`, '$.form') LIKE 'more %')
	OR (json_extract(`payload`, '$.type') = 'superlative' AND json_extract(`payload`, '$.form') LIKE 'most %')
);--> statement-breakpoint
-- 3. IPA house style (ipaSchema): no syllable dots, ər and ɜːr for the r-coloured vowels, and e
--    for an American ɛ; a British ɚ or ɝ (non-rhotic) becomes ə or ɜː. Every live pronunciation and
--    form ipa is rewritten with its content key (`accent|ipa`, and a form's key ends `accent:ipa`).
--    Where live facts of one subject meet on one key, the published one, else the oldest, stays
--    and the others are retracted first, so the rewrite never collides.
UPDATE `facts`
SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `revalidate_since` = NULL
WHERE `id` IN (
	WITH `transcribed` AS (
		SELECT `id`, `kind`, `subject_id`, `status`, `created_at`, `content_key`,
			json_extract(`payload`, '$.ipa') AS `ipa`, json_extract(`payload`, '$.accent') AS `accent`
		FROM `facts`
		WHERE `kind` IN ('pronunciation', 'form') AND `status` IN ('pending', 'published')
			AND json_extract(`payload`, '$.ipa') IS NOT NULL
	),
	`house` AS (
		SELECT *, CASE `accent`
			WHEN 'us' THEN replace(replace(replace(replace(replace(`ipa`, '.', ''), 'ɝː', 'ɜːr'), 'ɝ', 'ɜːr'), 'ɚ', 'ər'), 'ɛ', 'e')
			ELSE replace(replace(replace(replace(`ipa`, '.', ''), 'ɝː', 'ɜː'), 'ɝ', 'ɜː'), 'ɚ', 'ə')
		END AS `next` FROM `transcribed`
	),
	`ranked` AS (
		SELECT `id`, row_number() OVER (
			PARTITION BY `kind`, `subject_id`, substr(`content_key`, 1, length(`content_key`) - length(`ipa`)) || `next`
			ORDER BY `status` = 'published' DESC, `created_at`, `id`
		) AS `rank` FROM `house`
	)
	SELECT `id` FROM `ranked` WHERE `rank` > 1
);--> statement-breakpoint
UPDATE `facts`
SET `payload` = json_set(`facts`.`payload`, '$.ipa', `house`.`next`),
	`content_key` = substr(`facts`.`content_key`, 1, length(`facts`.`content_key`) - length(`house`.`ipa`)) || `house`.`next`,
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
	SELECT `id`, `ipa`, CASE `accent`
		WHEN 'us' THEN replace(replace(replace(replace(replace(`ipa`, '.', ''), 'ɝː', 'ɜːr'), 'ɝ', 'ɜːr'), 'ɚ', 'ər'), 'ɛ', 'e')
		ELSE replace(replace(replace(replace(`ipa`, '.', ''), 'ɝː', 'ɜː'), 'ɝ', 'ɜː'), 'ɚ', 'ə')
	END AS `next`
	FROM (
		SELECT `id`, json_extract(`payload`, '$.ipa') AS `ipa`, json_extract(`payload`, '$.accent') AS `accent`
		FROM `facts`
		WHERE `kind` IN ('pronunciation', 'form') AND `status` IN ('pending', 'published')
			AND json_extract(`payload`, '$.ipa') IS NOT NULL
	)
) AS `house`
WHERE `facts`.`id` = `house`.`id` AND `house`.`next` <> `house`.`ipa`;--> statement-breakpoint
-- 4. zh translations use fullwidth punctuation and list each alternative once: ASCII ; , ( )
--    become ； ， （ ）, and the alternatives between fullwidth semicolons are trimmed, empty ones
--    dropped, and repeats after the first dropped, in order. A rewritten translation whose new key
--    (`zh|` and the lowercased text) another live translation of its sense holds is retracted;
--    the rest are rewritten. The scratch table lives only inside this migration.
CREATE TABLE `_zh_translations` (`id` text PRIMARY KEY NOT NULL, `subject_id` text NOT NULL, `next` text NOT NULL);--> statement-breakpoint
INSERT INTO `_zh_translations` (`id`, `subject_id`, `next`)
WITH RECURSIVE
`source` (`id`, `subject_id`, `text`) AS (
	SELECT `id`, `subject_id`, json_extract(`payload`, '$.text') FROM `facts`
	WHERE `kind` = 'translation' AND `status` IN ('pending', 'published') AND json_extract(`payload`, '$.language') = 'zh'
),
`walk` (`id`, `rest`, `result`) AS (
	SELECT `id`, replace(replace(replace(replace(`text`, ';', '；'), ',', '，'), '(', '（'), ')', '）') || '；', NULL FROM `source`
	UNION ALL
	SELECT `id`, substr(`rest`, instr(`rest`, '；') + 1),
		CASE
			WHEN trim(substr(`rest`, 1, instr(`rest`, '；') - 1)) = '' THEN `result`
			WHEN `result` IS NULL THEN trim(substr(`rest`, 1, instr(`rest`, '；') - 1))
			WHEN instr('；' || `result` || '；', '；' || trim(substr(`rest`, 1, instr(`rest`, '；') - 1)) || '；') > 0 THEN `result`
			ELSE `result` || '；' || trim(substr(`rest`, 1, instr(`rest`, '；') - 1))
		END
	FROM `walk` WHERE `rest` <> ''
)
SELECT `walk`.`id`, `source`.`subject_id`, `walk`.`result` FROM `walk` JOIN `source` ON `source`.`id` = `walk`.`id`
WHERE `walk`.`rest` = '' AND `walk`.`result` IS NOT NULL AND `walk`.`result` <> `source`.`text`;--> statement-breakpoint
UPDATE `facts`
SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `revalidate_since` = NULL
WHERE `id` IN (
	SELECT `_zh_translations`.`id` FROM `_zh_translations`
	WHERE EXISTS (
		SELECT 1 FROM `facts` AS `holder`
		WHERE `holder`.`kind` = 'translation' AND `holder`.`subject_id` = `_zh_translations`.`subject_id`
			AND `holder`.`status` IN ('pending', 'published') AND `holder`.`id` <> `_zh_translations`.`id`
			AND `holder`.`content_key` = 'zh|' || lower(`_zh_translations`.`next`)
	)
);--> statement-breakpoint
UPDATE `facts`
SET `payload` = json_set(`facts`.`payload`, '$.text', `_zh_translations`.`next`),
	`content_key` = 'zh|' || lower(`_zh_translations`.`next`),
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `_zh_translations`
WHERE `facts`.`id` = `_zh_translations`.`id` AND `facts`.`status` IN ('pending', 'published');--> statement-breakpoint
DROP TABLE `_zh_translations`;--> statement-breakpoint
-- 5. The sense list rubric no longer answers uncertain over unverifiable frequency order: every
--    sense list published on an uncertain verdict is judged again in place. The mark predates the
--    reconcile cutoff so its next run enqueues them (500 per run); a fail invalidates the list.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'sense_list' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND json_extract(`review`, '$.verdict') = 'uncertain';--> statement-breakpoint
-- 6. Every row is stale: the gap rules changed for every entry, and the public document gains a
--    sense's region and the entry's gap closures. A stale row stays claimable and a stale view is
--    rebuilt on read; drain the rest with POST /manage/v1/work/rescore and
--    POST /manage/v1/public/rebuild.
UPDATE `worklist` SET `revision` = `revision` + 1;
