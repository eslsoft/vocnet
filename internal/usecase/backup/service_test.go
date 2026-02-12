//go:build integration

package backup

import (
	"bytes"
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlearnedword "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/learnedword"
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	"github.com/google/uuid"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
)

func TestServiceExportImportRoundTrip(t *testing.T) {
	requireSQLite(t)

	ctx := context.Background()

	srcDir := t.TempDir()
	srcDSN := "file:" + filepath.Join(srcDir, "src.db") + "?_fk=1&cache=shared"
	srcClient := openSQLiteClient(t, srcDSN)

	srcWords, srcLearnedWords := seedData(t, ctx, srcClient)

	exporter, err := NewService("sqlite", srcDSN)
	if err != nil {
		t.Fatalf("new exporter: %v", err)
	}

	var buf bytes.Buffer
	if err := exporter.Export(ctx, &buf); err != nil {
		t.Fatalf("export failed: %v", err)
	}

	dstDir := t.TempDir()
	dstDSN := "file:" + filepath.Join(dstDir, "dst.db") + "?_fk=1&cache=shared"
	dstClient := openSQLiteClient(t, dstDSN)

	importer, err := NewService("sqlite", dstDSN)
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
	srcClient := openSQLiteClient(t, srcDSN)

	srcWords, _ := seedData(t, ctx, srcClient)

	exporter, err := NewService("sqlite", srcDSN)
	if err != nil {
		t.Fatalf("new exporter: %v", err)
	}

	var buf bytes.Buffer
	if err := exporter.Export(ctx, &buf, WithTables([]string{"lemmas"})); err != nil {
		t.Fatalf("filtered export failed: %v", err)
	}

	dstDir := t.TempDir()
	dstDSN := "file:" + filepath.Join(dstDir, "dst.db") + "?_fk=1&cache=shared"
	dstClient := openSQLiteClient(t, dstDSN)

	importer, err := NewService("sqlite", dstDSN)
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

func seedData(t *testing.T, ctx context.Context, client *entdb.Client) ([]lemmaSnapshot, []LearnedWordSnapshot) {
	t.Helper()
	createdAt := time.Date(2025, 1, 1, 8, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(90 * time.Minute)
	nextReview := updatedAt.Add(48 * time.Hour)
	userID := uuid.MustParse("0f35f2e0-1f07-4fe4-9a98-c69619fa2ff6")

	word1, err := client.Lemma.Create().
		SetSurface("apple").
		SetNormalized("apple").
		SetLevel("A1").
		SetFrequencies([]entity.Frequency{{Corpus: "general", Count: 1000}}).
		SetCreatedAt(createdAt).
		SetUpdatedAt(updatedAt).
		Save(ctx)
	if err != nil {
		t.Fatalf("create word1: %v", err)
	}

	_, err = client.Lemma.Create().
		SetSurface("apples").
		SetNormalized("apples").
		SetVariant("PLURAL").
		SetLevel("A1").
		SetFrequencies([]entity.Frequency{{Corpus: "general", Count: 420}}).
		SetCreatedAt(createdAt.Add(time.Minute)).
		SetUpdatedAt(updatedAt.Add(time.Minute)).
		Save(ctx)
	if err != nil {
		t.Fatalf("create word2: %v", err)
	}

	_, err = client.LearnedWord.Create().
		SetUserID(userID).
		SetLexemeID("L12345").
		SetTerm(word1.Surface).
		SetNormal(strings.ToLower(word1.Surface)).
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
		SetReviewReps(2).
		SetQueryCount(5).
		SetNotes([]string{"daily review"}).
		SetContexts([]entity.LearnedWordContext{{Sentence: "An apple a day...", Source: 1, SourceRef: "proverb", CollectedAt: createdAt.Add(24 * time.Hour)}}).
		SetRelations([]entity.LearnedWordRelation{{Word: "apple", RelationType: 2, CreatedBy: "tester", CreatedAt: createdAt.Add(24 * time.Hour), UpdatedAt: createdAt.Add(36 * time.Hour)}}).
		SetCreatedAt(createdAt.Add(24 * time.Hour)).
		SetUpdatedAt(createdAt.Add(48 * time.Hour)).
		Save(ctx)
	if err != nil {
		t.Fatalf("create user word: %v", err)
	}

	return snapshotWords(t, ctx, client), snapshotLearnedWords(t, ctx, client)
}

type lemmaSnapshot struct {
	ID         int64
	Surface    string
	Normalized string
	Variant    string
	IsPrimary  bool
	Level      string
	Frequency  []entity.Frequency
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type LearnedWordSnapshot struct {
	ID                 int64
	UserID             uuid.UUID
	LexemeID           string
	Term               string
	Normal             string
	Language           string
	MasteryListen      int32
	MasteryRead        int32
	MasterySpell       int32
	MasteryPronounce   int32
	MasteryOverall     int32
	ReviewLastReviewAt *time.Time
	ReviewNextReviewAt *time.Time
	ReviewIntervalDays int32
	ReviewFailCount    int32
	ReviewReps         int32
	QueryCount         int64
	Notes              []string
	Contexts           []entity.LearnedWordContext
	Relations          []entity.LearnedWordRelation
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
			Surface:    row.Surface,
			Normalized: row.Normalized,
			Variant:    row.Variant,
			IsPrimary:  row.IsPrimary,
			Level:      row.Level,
			Frequency:  append([]entity.Frequency{}, row.Frequencies...),
			CreatedAt:  row.CreatedAt.UTC(),
			UpdatedAt:  row.UpdatedAt.UTC(),
		})
	}
	return result
}

func snapshotLearnedWords(t *testing.T, ctx context.Context, client *entdb.Client) []LearnedWordSnapshot {
	t.Helper()
	rows, err := client.LearnedWord.Query().Order(entlearnedword.ByID()).All(ctx)
	if err != nil {
		t.Fatalf("list user words: %v", err)
	}
	result := make([]LearnedWordSnapshot, 0, len(rows))
	for _, row := range rows {
		result = append(result, LearnedWordSnapshot{
			ID:                 row.ID,
			UserID:             row.UserID,
			LexemeID:           row.LexemeID,
			Term:               row.Term,
			Normal:             row.Normal,
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
			ReviewReps:         row.ReviewReps,
			QueryCount:         row.QueryCount,
			Notes:              append([]string{}, row.Notes...),
			Contexts:           append([]entity.LearnedWordContext{}, row.Contexts...),
			Relations:          append([]entity.LearnedWordRelation{}, row.Relations...),
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

func requireSQLite(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite", "file::memory:?cache=shared")
	if err != nil {
		t.Skipf("sqlite driver not available: %v", err)
		return
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Skipf("skipping sqlite-dependent tests: %v", err)
	}
}

func openSQLiteClient(t *testing.T, dsn string) *entdb.Client {
	t.Helper()

	rawDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}
	if _, err := rawDB.Exec("PRAGMA foreign_keys = ON"); err != nil {
		_ = rawDB.Close()
		t.Fatalf("enable foreign keys: %v", err)
	}

	drv := entsql.OpenDB(dialect.SQLite, rawDB)
	client := entdb.NewClient(entdb.Driver(drv))
	if err := client.Schema.Create(context.Background()); err != nil {
		_ = client.Close()
		t.Fatalf("create schema: %v", err)
	}

	t.Cleanup(func() {
		_ = client.Close()
	})
	return client
}
