-- Each part of speech of an entry's common senses gains a productive_use slot (docs/design.md,
-- Productive use), and the entry document's meanings gain `productive_use`, `skills`, and
-- `review.productive_use`. Every view is cleared and every row marked stale, as
-- public_view_v4_fields did: reads of an entry or sense rebuild it on the spot, and the rescore
-- (the cron's refreshStaleWork, or POST /manage/v1/work/rescore until `remaining` is 0) opens the
-- new slot on every entry. Drain the views with POST /manage/v1/public/rebuild.
DELETE FROM `public_forms`;--> statement-breakpoint
DELETE FROM `public_sense_topics`;--> statement-breakpoint
DELETE FROM `public_search`;--> statement-breakpoint
DELETE FROM `public_hypernyms`;--> statement-breakpoint
DELETE FROM `public_morphemes`;--> statement-breakpoint
DELETE FROM `public_meanings`;--> statement-breakpoint
DELETE FROM `public_entries`;--> statement-breakpoint
UPDATE `worklist` SET `revision` = `revision` + 1;
