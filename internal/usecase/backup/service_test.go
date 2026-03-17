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
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
)

func TestServiceExportImportRoundTrip(t *testing.T) {
	requireSQLite(t)

	ctx := context.Background()

	srcDir := t.TempDir()
	srcDSN := "file:" + filepath.Join(srcDir, "src.db") + "?_fk=1&cache=shared"
	srcClient := openSQLiteClient(t, srcDSN)

	srcWords := seedData(t, ctx, srcClient)

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
	_ = openSQLiteClient(t, dstDSN)

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

	dstClient2 := openSQLiteClient(t, dstDSN)
	snapDstWords := snapshotWords(t, ctx, dstClient2)
	if !reflect.DeepEqual(srcWords, snapDstWords) {
		t.Fatalf("words mismatch after import:\nwant %#v\ngot  %#v", srcWords, snapDstWords)
	}
}

func TestServiceExportTablesFilter(t *testing.T) {
	requireSQLite(t)

	ctx := context.Background()

	srcDir := t.TempDir()
	srcDSN := "file:" + filepath.Join(srcDir, "src.db") + "?_fk=1&cache=shared"
	srcClient := openSQLiteClient(t, srcDSN)

	srcWords := seedData(t, ctx, srcClient)

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
	_ = openSQLiteClient(t, dstDSN)

	importer, err := NewService("sqlite", dstDSN)
	if err != nil {
		t.Fatalf("new importer: %v", err)
	}
	if err := importer.Import(ctx, bytes.NewReader(buf.Bytes())); err != nil {
		t.Fatalf("filtered import failed: %v", err)
	}

	dstClient2 := openSQLiteClient(t, dstDSN)
	snapDstWords := snapshotWords(t, ctx, dstClient2)
	if !reflect.DeepEqual(srcWords, snapDstWords) {
		t.Fatalf("words mismatch after filtered import")
	}
}

func seedData(t *testing.T, ctx context.Context, client *entdb.Client) []lemmaSnapshot {
	t.Helper()
	createdAt := time.Date(2025, 1, 1, 8, 0, 0, 0, time.UTC)
	updatedAt := createdAt.Add(90 * time.Minute)

	_, err := client.Lemma.Create().
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

	return snapshotWords(t, ctx, client)
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
