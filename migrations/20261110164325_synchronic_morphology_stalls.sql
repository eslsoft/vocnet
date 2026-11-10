-- Twenty A1 entries stalled on slots no submission could pass (docs/design.md, Word formation,
-- Gap closures, Relations by part of speech):
--   * word formation follows one synchronic rule: a word not built on a present-day English word
--     is a simple word, one base part ("important", "factory"), a submission names no Latin or
--     Greek root, and a one-part base naming another lemma claims a conversion or back-formation
--     ("shelve" from "shelf", "televise" from "television");
--   * a family closure weighs the rejected word formations of other entries built on the word;
--   * a grammar closure passes for a pronoun that governs no agreement ("yourself", "each other",
--     "who") and an adverb used only after a number or clock time ("a.m.");
--   * a pronoun sense needs no relation.
--
-- 1. Published formations with a root part are judged again in place under the new rubric: a fail
--    invalidates the formation and reopens the entry's word formation gap. The mark predates the
--    reconcile cutoff so its next run enqueues them. No public document reads the mark. Rejected
--    facts stay as they are: dedupe ignores them, so a producer resubmits.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `kind` = 'morphology' AND `status` = 'published' AND `revalidate_since` IS NULL
	AND EXISTS (SELECT 1 FROM json_each(`facts`.`payload`, '$.parts') WHERE json_extract(`value`, '$.role') = 'root');
--> statement-breakpoint
-- 2. The gap rules and rubrics changed, so every row is stale, and no row keeps the open work of
--    its last claim, so a rescore stalls none and every entry with work is claimable again. A stale
--    row stays claimable; drain the rest with POST /manage/v1/work/rescore.
UPDATE `worklist` SET `revision` = `revision` + 1, `stalled` = 0, `claimed_work` = NULL;
