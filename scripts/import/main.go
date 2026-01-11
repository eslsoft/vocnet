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
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
)

const (
	defaultDatabaseURL     = "file:./data/vocnet.db?_fk=1"
	defaultBatchSize       = 32
	defaultWikidataFile    = "~/lexemes/english-lexemes.json"
	defaultWikidataLimit   = 0
	defaultECDictURL       = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	defaultECDictCacheDir  = ""
	defaultWordNetDataPath = ""
)

type pipelineConfig struct {
	databaseURL    string
	batchSize      int
	wikidataFile   string
	wikidataLimit  int
	runWikidata    bool
	runECDict      bool
	ecdictURL      string
	ecdictCacheDir string
	ecdictNoCache  bool
	wordNetPath    string
	mobyFile       string
}

func main() {
	cfg := parseFlags()
	if err := runPipeline(cfg); err != nil {
		log.Fatalf("lexeme import failed: %v", err)
	}
}

func parseFlags() pipelineConfig {
	var cfg pipelineConfig

	flag.StringVar(&cfg.databaseURL, "database", defaultDatabaseURL, "Database connection URL")
	flag.IntVar(&cfg.batchSize, "batch", defaultBatchSize, "Maximum parallel operations")

	flag.StringVar(&cfg.wikidataFile, "wikidata-file", defaultWikidataFile, "Path to filtered Wikidata lexemes JSON")
	flag.IntVar(&cfg.wikidataLimit, "wikidata-limit", defaultWikidataLimit, "Optional limit of Wikidata lexemes to import (0 = no limit)")
	flag.BoolVar(&cfg.runWikidata, "wikidata", true, "Enable Wikidata ingestion stage")

	flag.BoolVar(&cfg.runECDict, "ecdict", true, "Enable ECDICT ingestion stage")
	flag.StringVar(&cfg.ecdictURL, "ecdict-url", defaultECDictURL, "ECDICT SQLite download URL")
	flag.StringVar(&cfg.ecdictCacheDir, "ecdict-cache", defaultECDictCacheDir, "ECDICT cache directory (default: user cache dir/vocnet)")
	flag.BoolVar(&cfg.ecdictNoCache, "ecdict-no-cache", false, "Force re-download of ECDICT archive")

	flag.StringVar(&cfg.wordNetPath, "wordnet-path", defaultWordNetDataPath, "Optional WordNet data path (stage pending implementation)")
	flag.StringVar(&cfg.mobyFile, "moby-file", "", "Path to Moby Hyphenator (mhyph.txt) for extra syllables")

	flag.Parse()

	// Get database URL from environment if not set via flag
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

// initializeEntClient creates and initializes an Ent client with proper configuration.
func initializeEntClient(databaseURL string) (*entdb.Client, func(), error) {
	// Determine driver name from DSN
	driverName := "sqlite3"
	dataSourceName := databaseURL

	if strings.HasPrefix(databaseURL, "postgres://") || strings.HasPrefix(databaseURL, "postgresql://") {
		driverName = "postgres"
	} else if strings.HasPrefix(databaseURL, "file:") {
		// Ensure SQLite DSN has required params
		if !strings.Contains(databaseURL, "_fk=") {
			if strings.Contains(databaseURL, "?") {
				dataSourceName = databaseURL + "&_fk=1"
			} else {
				dataSourceName = databaseURL + "?_fk=1"
			}
		}
	}

	// Open database with proper SQL driver configuration
	drv, err := sql.Open(driverName, dataSourceName)
	if err != nil {
		return nil, nil, fmt.Errorf("open database driver: %w", err)
	}

	// Configure connection pool
	db := drv.DB()
	db.SetMaxIdleConns(5)
	db.SetMaxOpenConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(1 * time.Minute)

	// Create Ent client
	opts := []entdb.Option{entdb.Driver(drv)}

	// Enable debug mode for imports (useful for troubleshooting)
	if os.Getenv("DEBUG") != "" {
		opts = append(opts, entdb.Debug())
		log.Printf("[init] SQL debug mode enabled")
	}

	client := entdb.NewClient(opts...)

	// Run schema migration
	ctx := context.Background()
	if err := client.Schema.Create(ctx); err != nil {
		_ = client.Close()
		return nil, nil, fmt.Errorf("migrate schema: %w", err)
	}

	// Return cleanup function
	cleanup := func() {
		if err := client.Close(); err != nil {
			log.Printf("[cleanup] Warning: failed to close database: %v", err)
		}
	}

	return client, cleanup, nil
}

func runPipeline(cfg pipelineConfig) error {
	// Setup logging to file
	logFile, err := setupLogging()
	if err != nil {
		return fmt.Errorf("setup logging: %w", err)
	}
	defer logFile.Close()

	fmt.Printf("\n📝 Logs are being written to: %s\n", logFile.Name())
	fmt.Printf("   (Only warnings and errors will be shown on screen)\n\n")

	// Initialize database connection
	log.Printf("[init] Connecting to database: %s", cfg.databaseURL)

	// Create Ent client using proper initialization
	entClient, cleanup, err := initializeEntClient(cfg.databaseURL)
	if err != nil {
		return fmt.Errorf("initialize ent client: %w", err)
	}
	defer cleanup()

	log.Printf("[init] Database initialized successfully")

	// Initialize import service
	importService := NewLexemeImportService(entClient)

	ctx := context.Background()
	var reports []*ImportReport
	var wikidataImporter *wikidataImporter

	// Stage 1: Wikidata import
	if cfg.runWikidata {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 1: Wikidata Import")
		log.Println(strings.Repeat("=", 80))

		wikidataImporter = newWikidataImporter(cfg, importService)
		start := time.Now()
		report, err := wikidataImporter.Run(ctx)
		if err != nil {
			log.Printf("[wikidata] Warning: stage completed with errors: %v", err)
		}
		log.Printf("[wikidata] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
		reports = append(reports, report)
	}

	// Stage 2: ECDICT import (new words only)
	if cfg.runECDict {
		enricher, err := newECDICTEnricher(cfg)
		if err != nil {
			return fmt.Errorf("ECDICT enricher: %w", err)
		}

		if enricher != nil {
			// Register known words from Wikidata stage
			if wikidataImporter != nil {
				importedWords := wikidataImporter.GetImportedWords()
				log.Printf("[ecdict] Registering %d words from Wikidata", len(importedWords))
				enricher.RegisterKnownWords(importedWords)
			}

			log.Println("\n" + strings.Repeat("=", 80))
			log.Println("STAGE 2: ECDICT Import")
			log.Println(strings.Repeat("=", 80))

			// Phase 1: Import new words
			ecdictImporter := newECDictImporter(cfg, importService, enricher)
			start := time.Now()
			report, err := ecdictImporter.Run(ctx)
			if err != nil {
				return fmt.Errorf("ECDICT import stage: %w", err)
			}
			log.Printf("[ecdict] Import stage completed in %s\n", time.Since(start).Round(time.Millisecond))
			reports = append(reports, report)
		}
	}

	// Stage 3: Moby Hyphenator Import
	if cfg.mobyFile != "" {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 4: Moby Hyphenator Import")
		log.Println(strings.Repeat("=", 80))

		mobyImporter := newMobyImporter(cfg, importService)
		start := time.Now()
		report, err := mobyImporter.Run(ctx)
		if err != nil {
			log.Printf("[moby] Warning: stage completed with errors: %v", err)
		}
		log.Printf("[moby] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
		reports = append(reports, report)
	}

	// Print overall summary
	printOverallSummary(reports)

	return nil
}

// printOverallSummary prints a summary of all import stages
func printOverallSummary(reports []*ImportReport) {
	if len(reports) == 0 {
		return
	}

	fmt.Println("\n" + strings.Repeat("=", 80))
	fmt.Println("📊 OVERALL IMPORT SUMMARY")
	fmt.Println(strings.Repeat("=", 80))

	var totalProcessed, totalSuccess, totalFailed, totalSkipped int64
	var totalForms, totalRegular, totalIrregular int64

	for _, report := range reports {
		totalProcessed += report.Statistics.Total
		totalSuccess += report.Statistics.Successful
		totalFailed += report.Statistics.Failed
		totalSkipped += report.Statistics.Skipped
		totalForms += report.Statistics.TotalForms
		totalRegular += report.Statistics.RegularForms
		totalIrregular += report.Statistics.IrregularForms
	}

	fmt.Printf("\n📈 Aggregate Statistics:\n")
	fmt.Printf("  Total Processed: %d\n", totalProcessed)
	fmt.Printf("  Total Successful: %d\n", totalSuccess)
	fmt.Printf("  Total Failed: %d\n", totalFailed)
	fmt.Printf("  Total Skipped: %d\n", totalSkipped)

	if totalForms > 0 {
		fmt.Printf("\n📋 Total Forms: %d\n", totalForms)
		fmt.Printf("  Regular: %d (%.1f%%)\n", totalRegular, float64(totalRegular)/float64(totalForms)*100)
		fmt.Printf("  Irregular: %d (%.1f%%)\n", totalIrregular, float64(totalIrregular)/float64(totalForms)*100)
	}

	fmt.Printf("\n📄 Detailed Reports:\n")
	for _, report := range reports {
		var reportFile string
		if report.StageName == "Wikidata" {
			reportFile = "reports/wikidata_import_report.json"
		} else if report.StageName == "ECDICT" {
			reportFile = "reports/ecdict_import_report.json"
		} else if report.StageName == "Moby" {
			reportFile = "reports/moby_import_report.json"
		}
		if reportFile != "" {
			fmt.Printf("  %s: %s\n", report.StageName, reportFile)
		}
	}

	fmt.Println(strings.Repeat("=", 80))
}
