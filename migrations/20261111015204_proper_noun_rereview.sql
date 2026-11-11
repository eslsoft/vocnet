-- Entry and sense review now admit the proper nouns learner's dictionaries print (countries,
-- nationalities, languages, religions, festivals, major cities, well-known geographical features)
-- and fail only personal, brand, organisation, and minor place names (docs/design.md, Entry
-- admission). The earlier rubrics failed every proper name, so "London" was rejected.
--
-- An entry or sense slot whose latest rejection gave a proper name as its reason goes back to
-- pending through the `rereview` transition (rejected -> pending), unless a curator settled it, it
-- is a correction, or the slot already holds a live fact: the slot is exclusive, so one fact per
-- slot revives. The timestamps predate the reconcile cutoff so its next run enqueues the facts for
-- review under the new rubrics.
--
-- 1. The rows of the entries that own a revived fact are stale, and an entry whose entry fact
--    revives is live again. This runs first, while the facts are still rejected.
WITH `revived` AS (
	SELECT `facts`.`kind`, `facts`.`subject_id`
	FROM `facts`
	WHERE `facts`.`kind` IN ('entry', 'sense') AND `facts`.`status` = 'rejected' AND `facts`.`supersedes_id` IS NULL
		AND coalesce(json_extract(`facts`.`review`, '$.reviewer'), '') <> 'curator'
		AND (lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%proper name%'
			OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%proper-name%'
			OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%proper noun%'
			OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%name of a place%'
			OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%name of a person%')
		AND NOT EXISTS (
			SELECT 1 FROM `facts` AS `live`
			WHERE `live`.`kind` = `facts`.`kind` AND `live`.`subject_id` = `facts`.`subject_id` AND `live`.`status` IN ('pending', 'published')
		)
		AND NOT EXISTS (
			SELECT 1 FROM `facts` AS `later`
			WHERE `later`.`kind` = `facts`.`kind` AND `later`.`subject_id` = `facts`.`subject_id`
				AND `later`.`status` = 'rejected' AND `later`.`supersedes_id` IS NULL
				AND (`later`.`updated_at` > `facts`.`updated_at` OR (`later`.`updated_at` = `facts`.`updated_at` AND `later`.`id` > `facts`.`id`))
		)
)
UPDATE `worklist`
SET `revision` = `revision` + 1,
	`live` = CASE WHEN `entry_id` IN (SELECT `subject_id` FROM `revived` WHERE `kind` = 'entry') THEN 1 ELSE `live` END
WHERE `entry_id` IN (SELECT `subject_id` FROM `revived` WHERE `kind` = 'entry')
	OR `entry_id` IN (SELECT `senses`.`entry_id` FROM `senses` JOIN `revived` ON `revived`.`kind` = 'sense' AND `revived`.`subject_id` = `senses`.`id`);
--> statement-breakpoint
-- 2. The same facts return to pending; the review stays as the record of the old verdict until the
--    new review replaces it.
UPDATE `facts`
SET `status` = 'pending', `revalidate_since` = NULL, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `facts`.`kind` IN ('entry', 'sense') AND `facts`.`status` = 'rejected' AND `facts`.`supersedes_id` IS NULL
	AND coalesce(json_extract(`facts`.`review`, '$.reviewer'), '') <> 'curator'
	AND (lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%proper name%'
		OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%proper-name%'
		OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%proper noun%'
		OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%name of a place%'
		OR lower(json_extract(`facts`.`review`, '$.reason')) LIKE '%name of a person%')
	AND NOT EXISTS (
		SELECT 1 FROM `facts` AS `live`
		WHERE `live`.`kind` = `facts`.`kind` AND `live`.`subject_id` = `facts`.`subject_id` AND `live`.`status` IN ('pending', 'published')
	)
	AND NOT EXISTS (
		SELECT 1 FROM `facts` AS `later`
		WHERE `later`.`kind` = `facts`.`kind` AND `later`.`subject_id` = `facts`.`subject_id`
			AND `later`.`status` = 'rejected' AND `later`.`supersedes_id` IS NULL
			AND (`later`.`updated_at` > `facts`.`updated_at` OR (`later`.`updated_at` = `facts`.`updated_at` AND `later`.`id` > `facts`.`id`))
	);
