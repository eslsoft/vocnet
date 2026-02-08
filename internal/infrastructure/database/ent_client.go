package database

import (
	"context"
	"fmt"

	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent"

	"entgo.io/ent/dialect/sql"
	_ "github.com/lib/pq"
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

	drv, err := sql.Open(driverName, dataSourceName)
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
	if err := client.Schema.Create(ctx); err != nil {
		return nil, func() { _ = client.Close() }, fmt.Errorf("migrate schema: %w", err)
	}

	return client, func() { _ = client.Close() }, err
}
