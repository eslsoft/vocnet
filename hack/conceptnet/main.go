package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
)

const (
	defaultDatabaseURL    = "file:./data/vocnet.db?_fk=1"
	defaultConceptnetFile = "./data/conceptnet-assertions-5.7.0.csv.gz"
	defaultConceptnetLang = "en"
	defaultConceptnetMin  = 1.0
	defaultBatchSize      = 256
)

type config struct {
	databaseURL string
	filePath    string
	language    string
	minWeight   float64
	batchSize   int
}

func main() {
	cfg := parseFlags()
	if err := run(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "conceptnet import failed: %v\n", err)
		os.Exit(1)
	}
}

func parseFlags() config {
	var cfg config
	flag.StringVar(&cfg.databaseURL, "database", defaultDatabaseURL, "Database connection URL")
	flag.StringVar(&cfg.filePath, "conceptnet-file", defaultConceptnetFile, "Path to ConceptNet assertions CSV (gz supported)")
	flag.StringVar(&cfg.language, "conceptnet-lang", defaultConceptnetLang, "ConceptNet language code (default: en)")
	flag.Float64Var(&cfg.minWeight, "conceptnet-min-weight", defaultConceptnetMin, "Minimum ConceptNet weight to import")
	flag.IntVar(&cfg.batchSize, "batch", defaultBatchSize, "Maximum parallel operations")
	flag.Parse()

	if cfg.databaseURL == defaultDatabaseURL {
		if envURL := os.Getenv("DATABASE_URL"); envURL != "" {
			cfg.databaseURL = envURL
		}
	}
	if cfg.batchSize <= 0 {
		cfg.batchSize = defaultBatchSize
	}
	return cfg
}

func run(cfg config) error {
	logFile, err := util.SetupLogging()
	if err != nil {
		return fmt.Errorf("setup logging: %w", err)
	}
	defer logFile.Close()

	fmt.Printf("\n📝 Logs are being written to: %s\n", logFile.Name())
	fmt.Printf("   (Only warnings and errors will be shown on screen)\n\n")

	client, cleanup, err := initializeEntClient(cfg.databaseURL)
	if err != nil {
		return fmt.Errorf("initialize ent client: %w", err)
	}
	defer cleanup()

	importService := store.NewLexemeImportService(client)
	ctx := context.Background()

	idMap, err := importService.LoadExternalIDMap(ctx)
	if err != nil {
		return fmt.Errorf("load external id map: %w", err)
	}
	log.Printf("[conceptnet] Loaded %d lemma surfaces for lexeme linking", len(idMap))

	importer := NewImporter(ImportConfig{
		FilePath:  cfg.filePath,
		Language:  cfg.language,
		MinWeight: cfg.minWeight,
		BatchSize: cfg.batchSize,
	}, client, idMap)

	start := time.Now()
	if _, err := importer.Run(ctx); err != nil {
		return err
	}
	log.Printf("[conceptnet] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
	return nil
}

func initializeEntClient(databaseURL string) (*entdb.Client, func(), error) {
	driverName := "sqlite3"
	dataSourceName := databaseURL

	if strings.HasPrefix(databaseURL, "postgres://") || strings.HasPrefix(databaseURL, "postgresql://") {
		driverName = "postgres"
	} else if strings.HasPrefix(databaseURL, "file:") {
		if !strings.Contains(databaseURL, "_fk=") {
			if strings.Contains(databaseURL, "?") {
				dataSourceName = databaseURL + "&_fk=1"
			} else {
				dataSourceName = databaseURL + "?_fk=1"
			}
		}
	}

	drv, err := sql.Open(driverName, dataSourceName)
	if err != nil {
		return nil, nil, fmt.Errorf("open database driver: %w", err)
	}

	db := drv.DB()
	db.SetMaxIdleConns(5)
	db.SetMaxOpenConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(1 * time.Minute)

	opts := []entdb.Option{entdb.Driver(drv)}
	if os.Getenv("DEBUG") != "" {
		opts = append(opts, entdb.Debug())
		log.Printf("[init] SQL debug mode enabled")
	}

	client := entdb.NewClient(opts...)
	if err := client.Schema.Create(context.Background()); err != nil {
		_ = client.Close()
		return nil, nil, fmt.Errorf("migrate schema: %w", err)
	}

	cleanup := func() {
		if err := client.Close(); err != nil {
			log.Printf("[cleanup] Warning: failed to close database: %v", err)
		}
	}

	return client, cleanup, nil
}
