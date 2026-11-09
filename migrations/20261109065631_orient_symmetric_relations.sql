-- Synonyms and antonyms are stored once per pair of senses, with the smaller sense id as the
-- subject. Flip every row stored the other way round, keeping its review. A live row whose
-- flipped twin is already live stays as it is: it is a duplicate to retract, not to merge.
UPDATE `facts`
SET
	`subject_id` = `object_id`,
	`object_id` = `subject_id`,
	`payload` = json_set(`payload`, '$.target_sense_id', `subject_id`),
	`content_key` = json_extract(`payload`, '$.type') || '|' || `subject_id`
WHERE `kind` = 'relation'
	AND json_extract(`payload`, '$.type') IN ('synonym', 'antonym')
	AND `subject_id` > `object_id`
	AND NOT (
		`status` IN ('pending', 'published')
		AND EXISTS (
			SELECT 1 FROM `facts` AS `twin`
			WHERE `twin`.`kind` = 'relation'
				AND `twin`.`content_key` = json_extract(`facts`.`payload`, '$.type') || '|' || `facts`.`subject_id`
				AND `twin`.`subject_id` = `facts`.`object_id`
				AND `twin`.`status` IN ('pending', 'published')
		)
	);
