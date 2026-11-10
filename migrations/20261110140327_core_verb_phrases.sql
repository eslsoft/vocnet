-- Only a core verb, one a CEFR learner list names as an A1 or A2 verb, needs phrases, and the entry
-- rubric passes a phrasal verb or verb idiom only when a learner's dictionary prints it
-- (docs/design.md, Phrases and Admission). Producers filling the earlier gap on nouns used as verbs
-- coined phrasal verbs the old rubric passed as transparent ("telephone in", "party down").
--
-- 1. The entry fact of every multiword entry an agent created in the last day is judged again in
--    place when it is a phrasal verb or verb idiom (a live verb sense) whose first word is a verb
--    lemma (a live entry with a live verb sense) and no CEFR list names it as a headword. Each mark
--    predates the reconcile cutoff so its next runs enqueue them (500 per run); a fail invalidates
--    the entry, which hides the phrase.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'entry' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND `subject_id` IN (
		SELECT `phrase`.`id` FROM `entries` AS `phrase`
		WHERE `phrase`.`lemma` LIKE '% %'
			AND `phrase`.`created_by` LIKE 'agent:%'
			AND `phrase`.`created_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
			AND NOT EXISTS (SELECT 1 FROM `lemma_cefr` WHERE `lemma_cefr`.`lemma` = `phrase`.`lemma`)
			AND EXISTS (
				SELECT 1 FROM `senses`
				WHERE `senses`.`entry_id` = `phrase`.`id` AND `senses`.`pos` = 'verb'
					AND EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published') AND `gloss`.`kind` = 'sense')
			)
			AND EXISTS (
				SELECT 1 FROM `entries` AS `head`
				JOIN `senses` ON `senses`.`entry_id` = `head`.`id` AND `senses`.`pos` = 'verb'
				WHERE `head`.`lemma` = substr(`phrase`.`lemma`, 1, instr(`phrase`.`lemma`, ' ') - 1)
					AND EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published') AND `gloss`.`kind` = 'sense')
			)
	);--> statement-breakpoint
-- 2. Every row is stale: the phrases gap moved off every verb no CEFR list names as an A1 or A2
--    verb. A stale row stays claimable; drain the rest with POST /manage/v1/work/rescore.
UPDATE `worklist` SET `revision` = `revision` + 1;
