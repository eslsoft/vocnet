-- A Jev pass no longer settles a hypernym or part_of (docs/design.md, Reviewer routing): the layer
-- rules and the most-general-whole rule live in the rubric alone, and the revalidation of
-- work_items_relation_layers let a confident Jev keep dog hypernym canine and head part_of animal.
--
-- 1. An everyday hypernym to a common technical taxon belongs in the biology layer, so it gets a
--    pending correction there with the same target instead of a revalidation that would reject it.
--    The correction is reviewed under the biology rubric and, once published, supersedes the
--    everyday fact. Curated facts and facts that already have a live correction are left alone. The
--    timestamps predate the reconcile cutoff so its next run enqueues the corrections.
INSERT INTO `facts` (`id`, `kind`, `subject_id`, `object_id`, `content_key`, `payload`, `status`, `exclusive`, `supersedes_id`, `author`, `created_at`, `updated_at`)
SELECT
	lower(substr(`uuid`, 1, 8) || '-' || substr(`uuid`, 9, 4) || '-4' || substr(`uuid`, 13, 3) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(`uuid`, 17, 3) || '-' || substr(`uuid`, 21, 12)),
	'relation', `subject_id`, `object_id`, `content_key` || '|biology', json_set(`payload`, '$.domain', 'biology'), 'pending', 0, `id`, 'admin:migration',
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
FROM (
	SELECT hex(randomblob(16)) AS `uuid`, `everyday`.`id`, `everyday`.`subject_id`, `everyday`.`object_id`, `everyday`.`content_key`, `everyday`.`payload`
	FROM `facts` AS `everyday`
	JOIN `senses` ON `senses`.`id` = `everyday`.`object_id`
	JOIN `entries` ON `entries`.`id` = `senses`.`entry_id`
	WHERE `everyday`.`kind` = 'relation' AND `everyday`.`status` = 'published'
		AND json_extract(`everyday`.`payload`, '$.type') = 'hypernym'
		AND json_extract(`everyday`.`payload`, '$.domain') IS NULL
		AND coalesce(json_extract(`everyday`.`review`, '$.reviewer'), '') <> 'curator'
		AND `entries`.`lemma` IN ('arthropod', 'bovine', 'canine', 'equid', 'feline', 'invertebrate', 'passerine', 'primate', 'rodent', 'ruminant', 'ungulate')
		AND NOT EXISTS (
			SELECT 1 FROM `facts` AS `correction`
			WHERE `correction`.`supersedes_id` = `everyday`.`id` AND `correction`.`status` IN ('pending', 'published')
		)
		AND NOT EXISTS (
			SELECT 1 FROM `facts` AS `biology`
			WHERE `biology`.`kind` = 'relation' AND `biology`.`content_key` = `everyday`.`content_key` || '|biology'
				AND `biology`.`subject_id` = `everyday`.`subject_id` AND `biology`.`status` IN ('pending', 'published')
		)
);
--> statement-breakpoint
-- 2. Every other published hypernym and part_of is judged again in place by the Jev gate and the
--    rubric; one that fails is rejected. A fact with a live correction is left to its correction.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'relation' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND json_extract(`payload`, '$.type') IN ('hypernym', 'part_of')
	AND coalesce(json_extract(`review`, '$.reviewer'), '') <> 'curator'
	AND NOT EXISTS (
		SELECT 1 FROM `facts` AS `correction`
		WHERE `correction`.`supersedes_id` = `facts`.`id` AND `correction`.`status` IN ('pending', 'published')
	);
--> statement-breakpoint
-- 3. The reviews change the relations slots and public views of the entries at either end, so every
--    row is stale for the rescore and the view rebuild to drain.
UPDATE `worklist` SET `revision` = `revision` + 1;
