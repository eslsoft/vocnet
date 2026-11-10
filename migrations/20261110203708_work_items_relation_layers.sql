-- Work moves from entries to gap-level items, and relations lose their quotas (docs/design.md,
-- Work items, Relations):
--   * the relations gap (two relations per noun, verb, or adjective sense) becomes three slots: an
--     everyday category (a hypernym without a domain), the parts of a thing in a category (an
--     incoming part_of), and a synonym or antonym;
--   * an everyday hypernym must be a category word learners use, a domain hypernym a real term of
--     its taxonomy, and a part attaches to the most general common whole it belongs to.
--
-- 1. A relations closure said the recorded relations were the only precise ones, which the synonyms
--    slot now asks: it becomes a synonyms closure, with the content key the registry computes
--    (`gap|textKey(reason)`). Every status is rewritten, since stored payloads parse against the
--    closable gaps. No synonyms closure existed, so no live key collides.
UPDATE `facts`
SET `payload` = json_set(`payload`, '$.gap', 'synonyms'),
	`content_key` = 'synonyms|' || substr(`content_key`, length('relations|') + 1)
WHERE `kind` = 'gap_closure' AND json_extract(`payload`, '$.gap') = 'relations';
--> statement-breakpoint
-- 2. The published ones are judged again in place under the synonyms rubric, and so is every
--    published hypernym (all in the everyday layer, which now fails technical taxa) and part_of
--    (which now fails a part attached to a narrower kind of its whole). Curated facts are final for
--    the rules. The mark predates the reconcile cutoff so its next run enqueues them, 500 a run; each
--    stays public until its new verdict.
UPDATE `facts`
SET `revalidate_since` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `status` = 'published' AND `revalidate_since` IS NULL
	AND coalesce(json_extract(`review`, '$.reviewer'), '') <> 'curator'
	AND (
		(`kind` = 'gap_closure' AND json_extract(`payload`, '$.gap') = 'synonyms')
		OR (`kind` = 'relation' AND json_extract(`payload`, '$.type') IN ('hypernym', 'part_of'))
	);
--> statement-breakpoint
-- 3. The gap rules changed and no row has work items yet, so every row is stale: the rescore
--    builds each entry's items, and the view rebuild its hypernym walk rows and the rarity of its
--    topic tags. Drain both with POST /manage/v1/work/rescore and POST /manage/v1/public/rebuild
--    until `remaining` is 0, or let the cron drain them 100 a run.
UPDATE `worklist` SET `revision` = `revision` + 1;
