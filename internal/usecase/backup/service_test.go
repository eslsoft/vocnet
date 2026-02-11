//go:build integration

package backup

import (
	"bytes"
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/enttest"
	entlearnedlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/learnedword"
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"

	"entgo.io/ent/dialect"
)

func TestServiceExportImportRoundTrip(t *testing.T) {
	requireSQLite(t)

	ctx := context.Background()

	srcDir := t.TempDir()
	srcDSN := "file:" + filepath.Join(srcDir, "src.db") + "?_fk=1&cache=shared"
	srcClient := enttest.Open(t, dialect.SQLite, srcDSN)
	t.Cleanup(func() { srcClient.Close() })

	srcWords, srcLearnedWords := seedData(t, ctx, srcClient)

	exporter, err := NewService("sqlite3", srcDSN)
	if err != nil {
		t.Fatalf("new exporter: %v", err)
	}

	var buf bytes.Buffer
	if err := exporter.Export(ctx, &buf); err != nil {
		t.Fatalf("export failed: %v", err)
	}

	dstDir := t.TempDir()
	dstDSN := "file:" + filepath.Join(dstDir, "dst.db") + "?_fk=1&cache=shared"
	dstClient := enttest.Open(t, dialect.SQLite, dstDSN)
	t.Cleanup(func() { dstClient.Close() })

	importer, err := NewService("sqlite3", dstDSN)
	if err != nil {
		t.Fatalf("new importer: %v", err)
	}
	if err := importer.Import(ctx, bytes.NewReader(buf.Bytes())); err != nil {
		t.Fatalf("import failed: %v", err)
	}

	snapSrcWords := snapshotWords(t, ctx, srcClient)
	if !reflect.DeepEqual(snapSrcWords, srcWords) {
		t.Fatalf("source words snapshot mutated: want %#v got %#v", srcWords, snapSrcWords)
	}

	snapDstWords := snapshotWords(t, ctx, dstClient)
	if !reflect.DeepEqual(srcWords, snapDstWords) {
		t.Fatalf("words mismatch after import:\nwant %#v\ngot  %#v", srcWords, snapDstWords)
	}

	snapSrcLearnedWords := snapshotLearnedWords(t, ctx, srcClient)
	if !reflect.DeepEqual(snapSrcLearnedWords, srcLearnedWords) {
		t.Fatalf("source user words snapshot mutated: want %#v got %#v", srcLearnedWords, snapSrcLearnedWords)
	}

	snapDstLearnedWords := snapshotLearnedWords(t, ctx, dstClient)
	if !reflect.DeepEqual(srcLearnedWords, snapDstLearnedWords) {
		t.Fatalf("user words mismatch after import:\nwant %#v\ngot  %#v", srcLearnedWords, snapDstLearnedWords)
	}
}

func TestServiceExportTablesFilter(t *testing.T) {
	requireSQLite(t)

	ctx := context.Background()

	srcDir := t.TempDir()
	srcDSN := "file:" + filepath.Join(srcDir, "src.db") + "?_fk=1&cache=shared"
	srcClient := enttest.Open(t, dialect.SQLite, srcDSN)
	t.Cleanup(func() { srcClient.Close() })

	srcWords, _ := seedData(t, ctx, srcClient)

	exporter, err := NewService("sqlite3", srcDSN)
	if err != nil {
		t.Fatalf("new exporter: %v", err)
	}

	var buf bytes.Buffer
	if err := exporter.Export(ctx, &buf, WithTables([]string{"words"})); err != nil {
		t.Fatalf("filtered export failed: %v", err)
	}

	dstDir := t.TempDir()
	dstDSN := "file:" + filepath.Join(dstDir, "dst.db") + "?_fk=1&cache=shared"
	dstClient := enttest.Open(t, dialect.SQLite, dstDSN)
	t.Cleanup(func() { dstClient.Close() })

	importer, err := NewService("sqlite3", dstDSN)
	if err != nil {
		t.Fatalf("new importer: %v", err)
	}
	if err := importer.Import(ctx, bytes.NewReader(buf.Bytes())); err != nil {
		t.Fatalf("filtered import failed: %v", err)
	}

	snapDstWords := snapshotWords(t, ctx, dstClient)
	if !reflect.DeepEqual(srcWords, snapDstWords) {
		t.Fatalf("words mismatch after filtered import")
	}

	dstLearnedWords := snapshotLearnedWords(t, ctx, dstClient)
	if len(dstLearnedWords) != 0 {
		t.Fatalf("expected no user words, got %#v", dstLearnedWords)
	}
}

func seedData(t *testing.T, ctx context.Context, client *entdb.Client) ([]lemmaSnapshot, []LearnedLemmaSnapshot) {
	t.Helper()
	createdAt := time.Date(2025, 1, 1, 8, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(90 * time.Minute)
	nextReview := updatedAt.Add(48 * time.Hour)

	word1, err := client.Word.Create().
		SetText("apple").
		SetLanguage("en").
		SetWordType("lemma").
		SetPhonetics([]entity.WordPhonetic{{IPA: "ˈæpəl", Dialect: "us"}}).
		SetDefinitions([]entity.WordDefinition{{Pos: "noun", Text: "fruit", Language: "en"}}).
		SetCategories([]string{"fruit"}).
		SetRelations([]entity.WordRelation{{Word: "pear", RelationType: 1}}).
		SetCreatedAt(createdAt).
		SetUpdatedAt(updatedAt).
		Save(ctx)
	if err != nil {
		t.Fatalf("create word1: %v", err)
	}

	_, err = client.Word.Create().
		SetText("apples").
		SetLanguage("en").
		SetWordType("plural").
		SetLemma(word1.Text).
		SetCreatedAt(createdAt.Add(time.Minute)).
		SetUpdatedAt(updatedAt.Add(time.Minute)).
		Save(ctx)
	if err != nil {
		t.Fatalf("create word2: %v", err)
	}

	_, err = client.LearnedLexeme.Create().
		SetUserID(42).
		SetTerm(word1.Text).
		SetLanguage("en").
		SetMasteryListen(3).
		SetMasteryRead(4).
		SetMasterySpell(2).
		SetMasteryPronounce(1).
		SetMasteryOverall(2).
		SetReviewLastReviewAt(updatedAt).
		SetReviewNextReviewAt(nextReview).
		SetReviewIntervalDays(3).
		SetReviewFailCount(1).
		SetQueryCount(5).
		SetNotes("daily review").
		SetSentences([]entity.Sentence{{Text: "An apple a day...", Source: 1}}).
		SetRelations([]entity.LearnedLexemeRelation{{Word: "apple", RelationType: 2, CreatedBy: "tester", CreatedAt: createdAt.Add(24 * time.Hour), UpdatedAt: createdAt.Add(36 * time.Hour)}}).
		SetCreatedBy("tester").
		SetCreatedAt(createdAt.Add(24 * time.Hour)).
		SetUpdatedAt(createdAt.Add(48 * time.Hour)).
		Save(ctx)
	if err != nil {
		t.Fatalf("create user word: %v", err)
	}

	return snapshotWords(t, ctx, client), snapshotLearnedWords(t, ctx, client)
}

type lemmaSnapshot struct {
	ID         int
	Text       string
	Language   string
	WordType   string
	Lemma      *string
	Phonetics  []entity.WordPhonetic
	Meanings   []entity.WordDefinition
	Categories []string
	Phrases    []entity.Phrase
	Sentences  []entity.Sentence
	Relations  []entity.WordRelation
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type LearnedLemmaSnapshot struct {
	ID                 int
	UserID             int64
	Term               string
	Language           string
	MasteryListen      int16
	MasteryRead        int16
	MasterySpell       int16
	MasteryPronounce   int16
	MasteryUse         int16
	MasteryOverall     int32
	ReviewLastReviewAt *time.Time
	ReviewNextReviewAt *time.Time
	ReviewIntervalDays int32
	ReviewFailCount    int32
	QueryCount         int64
	Notes              *string
	Sentences          []entity.Sentence
	Relations          []entity.LearnedLexemeRelation
	CreatedBy          string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func snapshotWords(t *testing.T, ctx context.Context, client *entdb.Client) []lemmaSnapshot {
	t.Helper()
	rows, err := client.Lemma.Query().Order(entlemma.ByID()).All(ctx)
	if err != nil {
		t.Fatalf("list words: %v", err)
	}
	result := make([]lemmaSnapshot, 0, len(rows))
	for _, row := range rows {
		result = append(result, lemmaSnapshot{
			ID:         row.ID,
			Text:       row.Text,
			Language:   row.Language,
			WordType:   row.WordType,
			Lemma:      row.Lemma,
			Phonetics:  append([]entity.WordPhonetic{}, row.Phonetics...),
			Meanings:   append([]entity.WordDefinition{}, row.Definitions...),
			Categories: append([]string{}, row.Categories...),
			Phrases:    append([]entity.Phrase{}, row.Phrases...),
			Sentences:  append([]entity.Sentence{}, row.Sentences...),
			Relations:  append([]entity.WordRelation{}, row.Relations...),
			CreatedAt:  row.CreatedAt.UTC(),
			UpdatedAt:  row.UpdatedAt.UTC(),
		})
	}
	return result
}

func snapshotLearnedWords(t *testing.T, ctx context.Context, client *entdb.Client) []LearnedLemmaSnapshot {
	t.Helper()
	rows, err := client.LearnedLexeme.Query().Order(entlearnedlexeme.ByID()).All(ctx)
	if err != nil {
		t.Fatalf("list user words: %v", err)
	}
	result := make([]LearnedLemmaSnapshot, 0, len(rows))
	for _, row := range rows {
		result = append(result, LearnedLemmaSnapshot{
			ID:                 row.ID,
			UserID:             row.UserID,
			Term:               row.Term,
			Language:           row.Language,
			MasteryListen:      row.MasteryListen,
			MasteryRead:        row.MasteryRead,
			MasterySpell:       row.MasterySpell,
			MasteryPronounce:   row.MasteryPronounce,
			MasteryOverall:     row.MasteryOverall,
			ReviewLastReviewAt: copyTimePointer(row.ReviewLastReviewAt),
			ReviewNextReviewAt: copyTimePointer(row.ReviewNextReviewAt),
			ReviewIntervalDays: row.ReviewIntervalDays,
			ReviewFailCount:    row.ReviewFailCount,
			QueryCount:         row.QueryCount,
			Notes:              copyStringPointer(row.Notes),
			Sentences:          append([]entity.Sentence{}, row.Sentences...),
			Relations:          append([]entity.LearnedLexemeRelation{}, row.Relations...),
			CreatedBy:          row.CreatedBy,
			CreatedAt:          row.CreatedAt.UTC(),
			UpdatedAt:          row.UpdatedAt.UTC(),
		})
	}
	return result
}

func copyTimePointer(src *time.Time) *time.Time {
	if src == nil {
		return nil
	}
	t := src.UTC()
	return &t
}

func copyStringPointer(src *string) *string {
	if src == nil {
		return nil
	}
	s := *src
	return &s
}

func requireSQLite(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite3", "file::memory:?cache=shared")
	if err != nil {
		t.Skipf("sqlite driver not available: %v", err)
		return
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Skipf("skipping sqlite-dependent tests: %v", err)
	}
}
