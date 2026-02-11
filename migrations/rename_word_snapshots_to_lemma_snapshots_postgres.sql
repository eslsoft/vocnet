-- PostgreSQL migration: word_snapshots -> lemma_snapshots
-- Run this before starting the upgraded service if you want to keep existing snapshot history.

BEGIN;

ALTER TABLE IF EXISTS word_snapshots RENAME TO lemma_snapshots;

ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN term TO surface;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN terms TO lookup_terms;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN latest TO is_latest;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN data TO payload;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN qscore TO quality_overall;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN qscore_completeness TO quality_completeness;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN qscore_depth TO quality_depth;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN qscore_density TO quality_density;
ALTER TABLE IF EXISTS lemma_snapshots RENAME COLUMN qscore_validity TO quality_validity;

ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS normalized text;
ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS schema_version integer DEFAULT 1;
ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS lexeme_count integer DEFAULT 0;
ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS sense_count integer DEFAULT 0;
ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS form_count integer DEFAULT 0;
ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS relation_count integer DEFAULT 0;
ALTER TABLE IF EXISTS lemma_snapshots ADD COLUMN IF NOT EXISTS provider_count integer DEFAULT 0;

UPDATE lemma_snapshots
SET normalized = LOWER(surface)
WHERE normalized IS NULL OR normalized = '';

ALTER TABLE IF EXISTS lemma_snapshots ALTER COLUMN schema_version SET DEFAULT 1;
ALTER TABLE IF EXISTS lemma_snapshots ALTER COLUMN schema_version SET NOT NULL;

COMMIT;
