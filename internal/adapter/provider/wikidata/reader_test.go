package wikidata

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/stretchr/testify/require"
)

func TestReaderFetchLexemes_WithSensesAndForms_NoDeadlock(t *testing.T) {
	dir := t.TempDir()
	dataPath := filepath.Join(dir, "lexemes.json")
	require.NoError(t, os.WriteFile(dataPath, []byte("[]"), 0o644))

	dbPath := dataPath + ".idx.db"
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	require.NoError(t, createTestSchema(db))
	require.NoError(t, seedMissionData(db))

	r, err := NewReaderWithLogger(dataPath, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = r.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	lexemes, evidence, err := r.FetchLexemes(ctx, "mission", "en")
	require.NoError(t, err)
	require.Len(t, lexemes, 1)
	require.Equal(t, "L4208", lexemes[0].LexemeID)
	require.Len(t, lexemes[0].Senses, 1)
	require.Len(t, lexemes[0].Forms, 1)
	require.Equal(t, 1, evidence["lexemes_found"])
}

func TestReaderFetchLexemes_IndexedKeySearch(t *testing.T) {
	dir := t.TempDir()
	dataPath := filepath.Join(dir, "lexemes.json")
	require.NoError(t, os.WriteFile(dataPath, []byte("[]"), 0o644))

	dbPath := dataPath + ".idx.db"
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	require.NoError(t, createTestSchema(db))
	require.NoError(t, seedFallbackData(db))

	r, err := NewReaderWithLogger(dataPath, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = r.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// "could" exists as a form, not lemma, but should be found via indexed key query.
	lexemes, evidence, err := r.FetchLexemes(ctx, "could", "en")
	require.NoError(t, err)
	require.Len(t, lexemes, 1)
	require.Equal(t, "L1888", lexemes[0].LexemeID)
	require.Equal(t, normalizeSearchKey("could"), evidence["query_key"])
	require.Equal(t, "exact_form", evidence["match_level"])
	require.Equal(t, 90, evidence["match_score"])

	// "favourite" should hit "favorite" via variant lookup.
	lexemes, evidence, err = r.FetchLexemes(ctx, "favourite", "en")
	require.NoError(t, err)
	require.Len(t, lexemes, 1)
	require.Equal(t, "L5897", lexemes[0].LexemeID)
	require.Equal(t, "variant_lemma", evidence["match_level"])
	require.Equal(t, 50, evidence["match_score"])
}

func TestReaderFetchLexemes_VariantsExtracted(t *testing.T) {
	dir := t.TempDir()
	dataPath := filepath.Join(dir, "lexemes.json")
	require.NoError(t, os.WriteFile(dataPath, []byte("[]"), 0o644))

	dbPath := dataPath + ".idx.db"
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	require.NoError(t, createTestSchema(db))
	// Insert a lexeme with lemmas map containing en and en-us variants
	dataJSON := `{"id":"L5897","lemmas":{"en":{"language":"en","value":"favourite"},"en-us":{"language":"en-us","value":"favorite"}}}`
	_, err = db.Exec(`INSERT INTO lexemes (id, lemma, lemma_lower, lemma_key, lemma_variants, language, pos, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"L5897", "favourite", "favourite", normalizeSearchKey("favourite"), "favorite", "en", "adjective", dataJSON)
	require.NoError(t, err)

	r, err := NewReaderWithLogger(dataPath, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = r.Close() })

	ctx := context.Background()
	lexemes, _, err := r.FetchLexemes(ctx, "favourite", "en")
	require.NoError(t, err)
	require.Len(t, lexemes, 1)
	require.Equal(t, []string{"favorite"}, lexemes[0].Variants)
}

func createTestSchema(db *sql.DB) error {
	stmts := []string{
		`create table if not exists lexemes (
			id text primary key,
			lemma text not null,
			lemma_lower text not null,
			lemma_key text not null,
			lemma_variants text not null default '',
			language text not null,
			pos text not null,
			data text not null
		);`,
		`create table if not exists senses (
			id text primary key,
			lexeme_id text not null,
			gloss_en text,
			gloss_zh text
		);`,
		`create table if not exists forms (
			id text primary key,
			lexeme_id text not null,
			representation text not null,
			representation_lower text not null,
			representation_key text not null,
			features text,
			ipa text
		);`,
	}

	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func seedMissionData(db *sql.DB) error {
	if _, err := db.Exec(`INSERT INTO lexemes (id, lemma, lemma_lower, lemma_key, lemma_variants, language, pos, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"L4208", "mission", "mission", normalizeSearchKey("mission"), "", "en", "noun", `{"id":"L4208"}`); err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO senses (id, lexeme_id, gloss_en, gloss_zh) VALUES (?, ?, ?, ?)`,
		"S1", "L4208", "important assignment", "任务"); err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO forms (id, lexeme_id, representation, representation_lower, representation_key, features, ipa) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"F1", "L4208", "missions", "missions", normalizeSearchKey("missions"), `["Q146786"]`, "/ˈmɪʃənz/"); err != nil {
		return err
	}
	return nil
}

func seedFallbackData(db *sql.DB) error {
	// could -> form of can
	if _, err := db.Exec(`INSERT INTO lexemes (id, lemma, lemma_lower, lemma_key, lemma_variants, language, pos, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"L1888", "can", "can", normalizeSearchKey("can"), "", "en", "verb", `{"id":"L1888"}`); err != nil {
		return err
	}
	if _, err := db.Exec(`INSERT INTO forms (id, lexeme_id, representation, representation_lower, representation_key, features, ipa) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"F1888-1", "L1888", "could", "could", normalizeSearchKey("could"), `["Q1230649"]`, ""); err != nil {
		return err
	}

	// favorite -> lemma with variant "favourite"
	if _, err := db.Exec(`INSERT INTO lexemes (id, lemma, lemma_lower, lemma_key, lemma_variants, language, pos, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"L5897", "favorite", "favorite", normalizeSearchKey("favorite"), "favourite", "en", "adjective", `{"id":"L5897"}`); err != nil {
		return err
	}

	return nil
}
