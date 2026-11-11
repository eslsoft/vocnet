-- A sense or entry that can no longer show takes its relations out of live (docs/design.md, Fact
-- lifecycle): when a sense has no live gloss, or its entry no live entry fact, every live fact
-- linking it (as subject or as object) is retracted, curated ones included. Until now those
-- relations stayed published: hidden from the public view and filling no gap, yet holding their
-- content key, so producers read the slot as filled and their items fell to the curators.
--
-- The statements share one predicate: a live link whose subject or object sense cannot show. The
-- worklist and the work items are written first, while the links are still live.
--
-- 1. The relation slot items (category, parts, synonyms) in the curators' queue whose sense is an
--    end of such a link go back to the production queue: their stalls came from the dead link, and
--    the rescore keeps the reset because the gap is the one the item stored. Other items in
--    curation stalled on other grounds (topics on the taxonomy, family and phrases on entries)
--    and fill by no relation, so they stay.
UPDATE `work_items`
SET `attempts` = 0, `worked` = 0
WHERE `attempts` >= 3 AND `type` IN ('category', 'parts', 'synonyms') AND `subject_id` IN (
	WITH `dead` AS (
		SELECT `senses`.`id` FROM `senses`
		WHERE NOT EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published'))
			OR NOT EXISTS (SELECT 1 FROM `facts` AS `defining` WHERE `defining`.`kind` = 'entry' AND `defining`.`subject_id` = `senses`.`entry_id` AND `defining`.`status` IN ('pending', 'published'))
	),
	`dangling` AS (
		SELECT `subject_id`, `object_id` FROM `facts`
		WHERE `object_id` IS NOT NULL AND `status` IN ('pending', 'published')
			AND (`subject_id` IN (SELECT `id` FROM `dead`) OR `object_id` IN (SELECT `id` FROM `dead`))
	)
	SELECT `subject_id` FROM `dangling` UNION SELECT `object_id` FROM `dangling`
);--> statement-breakpoint
-- 2. The entries at both ends of such a link are stale, so their gaps and public views rescore.
UPDATE `worklist`
SET `revision` = `revision` + 1
WHERE `entry_id` IN (
	WITH `dead` AS (
		SELECT `senses`.`id` FROM `senses`
		WHERE NOT EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published'))
			OR NOT EXISTS (SELECT 1 FROM `facts` AS `defining` WHERE `defining`.`kind` = 'entry' AND `defining`.`subject_id` = `senses`.`entry_id` AND `defining`.`status` IN ('pending', 'published'))
	),
	`dangling` AS (
		SELECT `subject_id`, `object_id` FROM `facts`
		WHERE `object_id` IS NOT NULL AND `status` IN ('pending', 'published')
			AND (`subject_id` IN (SELECT `id` FROM `dead`) OR `object_id` IN (SELECT `id` FROM `dead`))
	)
	SELECT `senses`.`entry_id` FROM `senses`
	WHERE `senses`.`id` IN (SELECT `subject_id` FROM `dangling` UNION SELECT `object_id` FROM `dangling`)
);--> statement-breakpoint
-- 3. The links themselves are retracted (the `retract` transition: pending or published to
--    retracted). Dedupe ignores a retracted fact, so once the sense shows again a producer
--    resubmits the relation as a new fact.
UPDATE `facts`
SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), `revalidate_since` = NULL
WHERE `object_id` IS NOT NULL AND `status` IN ('pending', 'published') AND (
	`subject_id` IN (
		SELECT `senses`.`id` FROM `senses`
		WHERE NOT EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published'))
			OR NOT EXISTS (SELECT 1 FROM `facts` AS `defining` WHERE `defining`.`kind` = 'entry' AND `defining`.`subject_id` = `senses`.`entry_id` AND `defining`.`status` IN ('pending', 'published'))
	)
	OR `object_id` IN (
		SELECT `senses`.`id` FROM `senses`
		WHERE NOT EXISTS (SELECT 1 FROM `facts` AS `gloss` WHERE `gloss`.`kind` = 'sense' AND `gloss`.`subject_id` = `senses`.`id` AND `gloss`.`status` IN ('pending', 'published'))
			OR NOT EXISTS (SELECT 1 FROM `facts` AS `defining` WHERE `defining`.`kind` = 'entry' AND `defining`.`subject_id` = `senses`.`entry_id` AND `defining`.`status` IN ('pending', 'published'))
	)
);
