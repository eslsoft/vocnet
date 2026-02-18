package database

import (
	"context"
	stdsql "database/sql"
	"fmt"
	"net/url"
	"strings"

	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/lib/pq"
	_ "modernc.org/sqlite"
)

// NewEntClient constructs an ent.Client configured for the application's database.
func NewEntClient(cfg *config.Config) (*ent.Client, func(), error) {
	driverName, err := cfg.DatabaseDriver()
	if err != nil {
		return nil, nil, fmt.Errorf("determine database driver: %w", err)
	}

	dataSourceName, err := cfg.DatabaseURL()
	if err != nil {
		return nil, nil, fmt.Errorf("determine database dsn: %w", err)
	}

	drv, err := entsql.Open(driverName, dataSourceName)
	if err != nil {
		return nil, nil, err
	}
	drv.DB().SetMaxIdleConns(5)
	drv.DB().SetMaxOpenConns(25)

	opts := []ent.Option{ent.Driver(drv)}
	if cfg.Database.LogSQL {
		opts = append(opts, ent.Debug())
	}

	ctx := context.Background()
	client := ent.NewClient(opts...)
	if driverName == "postgres" {
		if schema, ok := postgresSchemaFromDSN(dataSourceName); ok {
			if err := ensurePostgresSchema(ctx, drv.DB(), schema); err != nil {
				return nil, func() { _ = client.Close() }, fmt.Errorf("ensure postgres schema: %w", err)
			}
		}
	}
	if err := client.Schema.Create(ctx); err != nil {
		return nil, func() { _ = client.Close() }, fmt.Errorf("migrate schema: %w", err)
	}

	return client, func() { _ = client.Close() }, err
}

func ensurePostgresSchema(ctx context.Context, db *stdsql.DB, schema string) error {
	if strings.TrimSpace(schema) == "" {
		return nil
	}
	query := fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s", pq.QuoteIdentifier(schema))
	if _, err := db.ExecContext(ctx, query); err != nil {
		return err
	}
	return nil
}

func postgresSchemaFromDSN(dsn string) (string, bool) {
	var searchPath string
	if strings.Contains(dsn, "://") {
		u, err := url.Parse(dsn)
		if err != nil {
			return "", false
		}
		searchPath = strings.TrimSpace(u.Query().Get("search_path"))
	} else {
		for _, field := range strings.Fields(dsn) {
			kv := strings.SplitN(field, "=", 2)
			if len(kv) == 2 && strings.EqualFold(kv[0], "search_path") {
				searchPath = strings.TrimSpace(kv[1])
				break
			}
		}
	}

	schema := firstSearchPathSchema(searchPath)
	return schema, schema != ""
}

func firstSearchPathSchema(searchPath string) string {
	searchPath = strings.Trim(searchPath, "\"'")
	if searchPath == "" {
		return ""
	}
	parts := strings.Split(searchPath, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(strings.Trim(parts[0], "\"'"))
}
