-- Per-sense slots split into core and common (docs/design.md, Scores, Gaps): only an entry's core
-- senses (the first three of its sense list's common order, plus the first common sense of each
-- part of speech those leave out) keep the relation, topic, and collocation slots and two examples
-- at A1 or A2; every other common sense needs a zh translation, one translated example, and its
-- grammar. The sense list rubric no longer fails over the order of common senses or a borderline
-- common/extra placement, and a topics closure passes when no topic of the taxonomy (now shown to
-- its review) fits.
--
-- 1. The curators' items whose rubric changed (sense_list, topics) or whose slot is core-only
--    (category, parts, synonyms) go back to the production queue. The rescore keeps the reset:
--    the item is not worked, so its gap is judged against the one it stored. An item of a sense
--    that is no longer core is deleted by the rescore.
UPDATE `work_items`
SET `attempts` = 0, `worked` = 0
WHERE `attempts` >= 3 AND `type` IN ('sense_list', 'topics', 'category', 'parts', 'synonyms');
--> statement-breakpoint
-- 2. The gap rules changed for every entry with a sense list, so every row is stale: the rescore
--    rebuilds each entry's items and completeness. Drain it with POST /manage/v1/work/rescore until
--    `remaining` is 0, or let the cron drain it 100 a run.
UPDATE `worklist` SET `revision` = `revision` + 1;
