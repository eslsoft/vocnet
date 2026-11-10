-- Three A1 slots had no value review could pass (docs/design.md, Grammar, word formation, and
-- collocations; Gap closures): a plural-only noun ("jeans") now takes number plural_only in place
-- of countability, a title used before a name ("Mrs") closes its grammar gap, and a shortened word
-- ("Mrs", "o'clock") states what it shortens in morphology.shortened. No stored payload changes
-- shape, so no fact is rewritten.
--
-- The gap rules and rubrics changed, so every row is stale, and no row keeps the open work of its
-- last claim, so a rescore stalls none and every entry with work is claimable again. A stale row
-- stays claimable; drain the rest with POST /manage/v1/work/rescore.
UPDATE `worklist` SET `revision` = `revision` + 1, `stalled` = 0, `claimed_work` = NULL;
