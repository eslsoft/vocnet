-- Search and filtered lists store new view rows (sort orders, meanings, search texts, forms by
-- spelling), so every view is cleared and marked stale as public_api_v2_clear marked them: the
-- revision moves, and the scored revision with it where the scores were current, because the scores
-- do not change and the entries must not turn claimable. Reads of an entry or sense rebuild it on
-- the spot; drain the rest with POST /manage/v1/public/rebuild.
DELETE FROM `public_forms`;--> statement-breakpoint
DELETE FROM `public_sense_topics`;--> statement-breakpoint
DELETE FROM `public_phrase_words`;--> statement-breakpoint
DELETE FROM `public_morphemes`;--> statement-breakpoint
DELETE FROM `public_entries`;--> statement-breakpoint
UPDATE `worklist`
SET `revision` = `revision` + 1,
	`scored_revision` = CASE WHEN `scored_revision` = `revision` THEN `revision` + 1 ELSE `scored_revision` END;
