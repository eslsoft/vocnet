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

func createTestSchema(db *sql.DB) error {
	stmts := []string{
		`create table if not exists lexemes (
			id text primary key,
			lemma text not null,
			lemma_lower text not null,
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
	if _, err := db.Exec(`insert into lexemes (id, lemma, lemma_lower, language, pos, data) values (?, ?, ?, ?, ?, ?)`,
		"L4208", "mission", "mission", "en", "noun", `{"id":"L4208"}`); err != nil {
		return err
	}
	if _, err := db.Exec(`insert into senses (id, lexeme_id, gloss_en, gloss_zh) values (?, ?, ?, ?)`,
		"S1", "L4208", "important assignment", "任务"); err != nil {
		return err
	}
	if _, err := db.Exec(`insert into forms (id, lexeme_id, representation, representation_lower, features, ipa) values (?, ?, ?, ?, ?, ?)`,
		"F1", "L4208", "missions", "missions", `["Q146786"]`, "/ˈmɪʃənz/"); err != nil {
		return err
	}
	return nil
}
