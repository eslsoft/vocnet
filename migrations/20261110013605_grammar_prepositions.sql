-- Grammar names the prepositions a sense takes (`prepositions`) instead of the bare `preposition`
-- pattern, which claimed only that the word takes some preposition. Live facts with that pattern
-- are retracted, as their author would retract them, so the grammar slot reopens and the producer
-- resubmits it with named prepositions. Every fact with the pattern, live or history, drops it from
-- its payload, because reads parse the current shape; its review still records the claim it judged.
-- The content key is rebuilt as `grammarKey` in server/domain/fact-kinds.ts builds it: the patterns
-- come last and sorted, so the pattern is removed with the comma or the segment around it.
--
-- The entries that owned a live fact are marked stale first, as a runtime retraction marks them, so
-- the cron's rescore reopens their grammar gap through `assessEntry`; a stale row stays claimable.
UPDATE `worklist`
SET `revision` = `revision` + 1
WHERE `entry_id` IN (
	SELECT `senses`.`entry_id`
	FROM `facts`
	JOIN `senses` ON `senses`.`id` = `facts`.`subject_id`
	WHERE `facts`.`kind` = 'grammar'
		AND `facts`.`status` IN ('pending', 'published')
		AND EXISTS (SELECT 1 FROM json_each(`facts`.`payload`, '$.patterns') WHERE `value` = 'preposition')
);
--> statement-breakpoint
UPDATE `facts`
SET
	`payload` = CASE
		WHEN json_array_length(`payload`, '$.patterns') = 1 THEN json_remove(`payload`, '$.patterns')
		ELSE json_set(`payload`, '$.patterns', (
			SELECT json_group_array(`value`) FROM json_each(`facts`.`payload`, '$.patterns') WHERE `value` <> 'preposition'
		))
	END,
	`content_key` = replace(replace(replace(replace(`content_key`,
		'patterns:preposition,', 'patterns:'),
		',preposition', ''),
		'|patterns:preposition', ''),
		'patterns:preposition', ''),
	`status` = CASE WHEN `status` IN ('pending', 'published') THEN 'retracted' ELSE `status` END,
	`revalidate_since` = CASE WHEN `status` IN ('pending', 'published') THEN NULL ELSE `revalidate_since` END,
	`updated_at` = CASE
		WHEN `status` IN ('pending', 'published') THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
		ELSE `updated_at`
	END
WHERE `kind` = 'grammar'
	AND EXISTS (SELECT 1 FROM json_each(`facts`.`payload`, '$.patterns') WHERE `value` = 'preposition');
