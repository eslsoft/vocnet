-- Topic tags published under the lenient Jev-first rubric are judged again by the
-- core-vocabulary rubric. Marking them for revalidation keeps them public while the
-- reconcile cron re-enqueues them (500 per run): a fail invalidates the tag, a pass
-- or uncertain reconfirms it. The mark predates the cron cutoff so the next run
-- picks the tags up.
UPDATE facts
SET revalidate_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE kind = 'topic' AND status = 'published' AND revalidate_since IS NULL;
