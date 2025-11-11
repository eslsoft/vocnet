package grpc

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent"

	_ "modernc.org/sqlite"
)

// setupTestDB creates an isolated SQLite database for testing.
// Each test gets its own temporary database file that is automatically
// cleaned up when the test completes.
func setupTestDB(t *testing.T) *ent.Client {
	t.Helper()

	// Create a temporary directory for the test database
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")

	// Use SQLite with foreign key support enabled
	// modernc.org/sqlite registers itself as "sqlite" driver
	dsn := "file:" + dbPath + "?_pragma=foreign_keys(1)"

	// Open a database connection with modernc.org/sqlite driver
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}

	// Create an ent driver from the database connection
	drv := entsql.OpenDB(dialect.SQLite, db)

	// Create the ent client with the driver
	client := ent.NewClient(ent.Driver(drv))

	// Run schema migration
	ctx := context.Background()
	if err := client.Schema.Create(ctx); err != nil {
		_ = client.Close()
		_ = db.Close()
		t.Fatalf("failed to create schema: %v", err)
	}

	// Register cleanup to close the client when test finishes
	t.Cleanup(func() {
		_ = client.Close()
		_ = db.Close()
	})

	return client
}
