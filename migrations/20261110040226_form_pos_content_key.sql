-- A form's content key now names its part of speech when it has one (`type|form|pos`), so a
-- labelled form is a claim of its own and replaces an unlabelled one by a correction. Every
-- labelled form fact, in any status, gets the key the registry computes. No two live facts can
-- collide: the old key `type|form` admitted one live fact per entry, and the unlabelled ones keep it.
-- The entries that own them are marked stale first, as data migrations must (docs/design.md,
-- Backfill and rebuild), with the scored revision kept current where it was, since no score
-- reads the key.
UPDATE `worklist`
SET `revision` = `revision` + 1,
	`scored_revision` = CASE WHEN `scored_revision` = `revision` THEN `revision` + 1 ELSE `scored_revision` END
WHERE `entry_id` IN (
	SELECT `subject_id` FROM `facts` WHERE `kind` = 'form' AND json_extract(`payload`, '$.pos') IS NOT NULL
);--> statement-breakpoint
UPDATE `facts`
SET `content_key` = `content_key` || '|' || json_extract(`payload`, '$.pos')
WHERE `kind` = 'form' AND json_extract(`payload`, '$.pos') IS NOT NULL;
