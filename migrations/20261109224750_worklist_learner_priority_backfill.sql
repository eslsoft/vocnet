-- Learner priority for the rows that exist. The frequency key is `frequencyKey` in
-- server/domain/reference.ts, the lowercase lemma. SQLite's lower() folds ASCII letters only, so
-- it equals the key for every lemma without a non-ASCII capital; no entry had one when this ran
-- (only "voilà" had a non-ASCII letter). New rows get the key from `frequencyKey` itself.
UPDATE worklist SET frequency_key = (select lower(lemma) from entries where entries.id = worklist.entry_id);
--> statement-breakpoint
-- `rankWorklistSql` in server/adapters/reference-sql.ts, which every reference import ends with.
UPDATE worklist SET level_rank = (select min(case level when 'A1' then 1 when 'A2' then 2 when 'B1' then 3 when 'B2' then 4 when 'C1' then 5 when 'C2' then 6 end) from lemma_cefr where lemma_cefr.lemma = (select lemma from entries where entries.id = worklist.entry_id)), zipf = (select zipf from word_frequency where word_frequency.word = worklist.frequency_key);
