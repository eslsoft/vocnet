-- SQLite migration: word_snapshots -> lemma_snapshots
-- Run this before starting the upgraded service if you want to keep existing snapshot history.

ALTER TABLE word_snapshots RENAME TO lemma_snapshots;

ALTER TABLE lemma_snapshots RENAME COLUMN term TO surface;
ALTER TABLE lemma_snapshots RENAME COLUMN terms TO lookup_terms;
ALTER TABLE lemma_snapshots RENAME COLUMN latest TO is_latest;
ALTER TABLE lemma_snapshots RENAME COLUMN data TO payload;
ALTER TABLE lemma_snapshots RENAME COLUMN qscore TO quality_overall;
ALTER TABLE lemma_snapshots RENAME COLUMN qscore_completeness TO quality_completeness;
ALTER TABLE lemma_snapshots RENAME COLUMN qscore_depth TO quality_depth;
ALTER TABLE lemma_snapshots RENAME COLUMN qscore_density TO quality_density;
ALTER TABLE lemma_snapshots RENAME COLUMN qscore_validity TO quality_validity;

ALTER TABLE lemma_snapshots ADD COLUMN normalized TEXT;
ALTER TABLE lemma_snapshots ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lemma_snapshots ADD COLUMN lexeme_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lemma_snapshots ADD COLUMN sense_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lemma_snapshots ADD COLUMN form_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lemma_snapshots ADD COLUMN relation_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lemma_snapshots ADD COLUMN provider_count INTEGER NOT NULL DEFAULT 0;

UPDATE lemma_snapshots
SET normalized = LOWER(surface)
WHERE normalized IS NULL OR normalized = '';
