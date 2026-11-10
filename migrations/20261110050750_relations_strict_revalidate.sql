-- The relation review got stricter (docs/design.md, Relations): a Jev answer under 0.5 settles a
-- fail for every type, the rubric names the audit's failures, and the reviewer sees the target's
-- other senses. Published relations the old rules let through on weak evidence are judged again:
--   * part_of whose target is a person-type noun (a body part is never part of a princess): the
--     target sense has a published hypernym chain up to the noun "person" (but is not that noun,
--     which a head is part of), or its gloss is
--     "A/An <head> …" or "A/An <word> <head> …" with a person head;
--   * every relation the LLM published over a Jev answer under the new floor;
--   * every relation in a structural conflict the new write rules refuse: a sense related to one
--     entry by two types (a symmetric type counted from both ends), or a hypernym between two
--     entries that are each a kind of the other.
-- Marking them keeps them public while the reconcile cron re-enqueues them (500 per run): a fail
-- invalidates the relation, a pass or uncertain reconfirms it. The mark predates the cron cutoff
-- so the next run picks them up. No public document reads the mark, so no revision is bumped.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `revalidate_since` IS NULL AND `id` IN (
	WITH RECURSIVE
	`relation` (`id`, `source`, `target`, `type`, `source_entry`, `target_entry`) AS MATERIALIZED (
		SELECT `facts`.`id`, `facts`.`subject_id`, `facts`.`object_id`, json_extract(`facts`.`payload`, '$.type'),
			`source`.`entry_id`, `target`.`entry_id`
		FROM `facts`
		JOIN `senses` AS `source` ON `source`.`id` = `facts`.`subject_id`
		JOIN `senses` AS `target` ON `target`.`id` = `facts`.`object_id`
		WHERE `facts`.`kind` = 'relation' AND `facts`.`status` = 'published'
	),
	`person` (`id`) AS (
		SELECT `relation`.`source` FROM `relation`
		JOIN `senses` ON `senses`.`id` = `relation`.`target`
		JOIN `entries` ON `entries`.`id` = `senses`.`entry_id`
		WHERE `relation`.`type` = 'hypernym' AND `entries`.`lemma` = 'person' AND `senses`.`pos` = 'noun'
		UNION
		SELECT `relation`.`source` FROM `relation` JOIN `person` ON `relation`.`target` = `person`.`id`
		WHERE `relation`.`type` = 'hypernym'
	),
	`target_gloss` (`id`, `words`) AS MATERIALIZED (
		SELECT `subject_id`, lower(replace(replace(json_extract(`payload`, '$.gloss'), ',', ' '), '.', ' ')) || ' '
		FROM `facts`
		WHERE `kind` = 'sense' AND `status` = 'published'
			AND `subject_id` IN (SELECT `target` FROM `relation` WHERE `type` = 'part_of')
	),
	`headed` (`id`, `rest`) AS (
		SELECT `id`, substr(`words`, instr(`words`, ' ') + 1) FROM `target_gloss`
		WHERE `words` LIKE 'a %' OR `words` LIKE 'an %'
	),
	`head_words` (`id`, `first`, `second`) AS (
		SELECT `id`, substr(`rest`, 1, instr(`rest`, ' ') - 1),
			substr(substr(`rest`, instr(`rest`, ' ') + 1), 1, instr(substr(`rest`, instr(`rest`, ' ') + 1), ' ') - 1)
		FROM `headed`
	),
	`person_noun` (`id`) AS MATERIALIZED (
		SELECT `id` FROM `person`
		UNION
		SELECT `id` FROM `head_words`
		WHERE `first` IN ('person', 'man', 'woman', 'girl', 'boy', 'child', 'employee', 'father', 'mother', 'daughter', 'son', 'police')
			OR `second` IN ('person', 'man', 'woman', 'girl', 'boy', 'child', 'employee', 'father', 'mother', 'daughter', 'son', 'police')
	),
	`relation_end` (`id`, `sense`, `entry`, `type`) AS MATERIALIZED (
		SELECT `id`, `source`, `target_entry`, `type` FROM `relation`
		UNION ALL
		SELECT `id`, `target`, `source_entry`, `type` FROM `relation` WHERE `type` IN ('synonym', 'antonym')
	),
	`crowded_end` (`sense`, `entry`) AS MATERIALIZED (
		SELECT `sense`, `entry` FROM `relation_end` GROUP BY `sense`, `entry` HAVING count(DISTINCT `type`) > 1
	)
	SELECT `relation`.`id` FROM `relation` JOIN `senses` ON `senses`.`id` = `relation`.`target`
	WHERE `relation`.`type` = 'part_of' AND `senses`.`pos` = 'noun' AND `relation`.`target` IN (SELECT `id` FROM `person_noun`)
	UNION
	SELECT `facts`.`id` FROM `facts`
	WHERE `facts`.`id` IN (SELECT `id` FROM `relation`)
		AND json_extract(`facts`.`review`, '$.reviewer') = 'jev+llm'
		AND json_extract(`facts`.`review`, '$.detail.opinions[0].reviewer') = 'jev'
		AND json_extract(`facts`.`review`, '$.detail.opinions[0].confidence') < 0.5
	UNION
	SELECT `relation_end`.`id` FROM `relation_end`
	JOIN `crowded_end` ON `crowded_end`.`sense` = `relation_end`.`sense` AND `crowded_end`.`entry` = `relation_end`.`entry`
	UNION
	SELECT `one`.`id` FROM `relation` AS `one`
	JOIN `relation` AS `other` ON `other`.`source_entry` = `one`.`target_entry` AND `other`.`target_entry` = `one`.`source_entry`
	WHERE `one`.`type` = 'hypernym' AND `other`.`type` = 'hypernym'
);
