-- Entries and summaries gain `cefr_source`, the entry its own `cefr` and `review.cefr`, and a word
-- the reference lists do not level takes its cefr fact's level (docs/design.md, CEFR levels). Where
-- the facts are produced, every view is marked stale: an entry or sense read rebuilds it on the spot,
-- and the cron or POST /manage/v1/public/rebuild drains the rest. A public replica holds no facts and
-- never rebuilds a view; the sync replaces its views, so this changes nothing there.
UPDATE `worklist` SET `revision` = `revision` + 1 WHERE EXISTS (SELECT 1 FROM `facts`);
