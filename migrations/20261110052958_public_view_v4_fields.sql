-- The entry document gains `syllables`, form objects (`{ form, irregular, ipa?, accent? }` in
-- place of strings), and example translations, and the worklist gains three gaps: syllables for a
-- single-word entry, a pronunciation per irregular form, and a translated example per counted
-- sense. Every view is cleared and marked stale as public_view_v3_clear marked them, but only the
-- revision moves: the scores change with the new gaps, so every row is left for `assessEntry` to
-- rescore (the cron's refreshStaleWork, 100 a run, or any write that touches the entry). Reads of
-- an entry or sense rebuild it on the spot; drain the rest with POST /manage/v1/public/rebuild.
DELETE FROM `public_forms`;--> statement-breakpoint
DELETE FROM `public_sense_topics`;--> statement-breakpoint
DELETE FROM `public_phrase_words`;--> statement-breakpoint
DELETE FROM `public_morphemes`;--> statement-breakpoint
DELETE FROM `public_search`;--> statement-breakpoint
DELETE FROM `public_meanings`;--> statement-breakpoint
DELETE FROM `public_entries`;--> statement-breakpoint
UPDATE `worklist` SET `revision` = `revision` + 1;
