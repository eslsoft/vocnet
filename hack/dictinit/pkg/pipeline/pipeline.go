package pipeline

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/sources/ecdict"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/sources/moby"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/sources/wikidata"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	_ "github.com/lib/pq"
	_ "github.com/mattn/go-sqlite3"
)

const (
	defaultDatabaseURL    = "file:./data/vocnet.db?_fk=1"
	defaultBatchSize      = 32
	defaultWikidataFile   = "./data/wikidata/english-lexemes.json"
	defaultWikidataLimit  = 0
	defaultECDictURL      = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	defaultECDictCacheDir = ""
	defaultMobyFile       = "./data/mhyph.txt"
	defaultWordbookDir    = "./pkg/wordbook/books"
)

type pipelineConfig struct {
	databaseURL       string
	batchSize         int
	wikidataFile      string
	wikidataLimit     int
	ecdictURL         string
	ecdictCacheDir    string
	ecdictNoCache     bool
	mobyFile          string
	wordbookDir       string
	coverageOutputDir string
	pipes             string
}

func Execute() {
	cfg := parseFlags()
	if err := runPipeline(cfg); err != nil {
		log.Fatalf("dict init failed: %v", err)
	}
}

func parseFlags() pipelineConfig {
	var cfg pipelineConfig

	flag.StringVar(&cfg.databaseURL, "database", defaultDatabaseURL, "Database connection URL")
	flag.IntVar(&cfg.batchSize, "batch", defaultBatchSize, "Maximum parallel operations")

	flag.StringVar(&cfg.wikidataFile, "wikidata-file", defaultWikidataFile, "Path to filtered Wikidata lexemes JSON")
	flag.IntVar(&cfg.wikidataLimit, "wikidata-limit", defaultWikidataLimit, "Optional limit of Wikidata lexemes to import (0 = no limit)")

	flag.StringVar(&cfg.ecdictURL, "ecdict-url", defaultECDictURL, "ECDICT SQLite download URL")
	flag.StringVar(&cfg.ecdictCacheDir, "ecdict-cache", defaultECDictCacheDir, "ECDICT cache directory (default: user cache dir/vocnet)")
	flag.BoolVar(&cfg.ecdictNoCache, "ecdict-no-cache", false, "Force re-download of ECDICT archive")

	flag.StringVar(&cfg.mobyFile, "moby-file", defaultMobyFile, "Path to Moby Hyphenator (mhyph.txt) for extra syllables")

	flag.StringVar(&cfg.pipes, "pipes", "*", "Pipeline stages to run (comma-separated: wikidata,ecdict,moby,coverage) or * for all")

	flag.StringVar(&cfg.wordbookDir, "wordbook-dir", defaultWordbookDir, "Directory containing wordbook JSON files")
	flag.StringVar(&cfg.coverageOutputDir, "coverage-output", "reports", "Directory to save coverage reports")

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
	logFile, err := util.SetupLogging()
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
	importService := store.NewLexemeImportService(entClient)

	ctx := context.Background()
	var reports []*report.ImportReport

	// Stage 1: Wikidata import
	if shouldRun(cfg.pipes, "wikidata") {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 1: Wikidata Import")
		log.Println(strings.Repeat("=", 80))

		wikidataImporter := wikidata.NewImporter(cfg.wikidataFile, cfg.wikidataLimit, cfg.batchSize, importService)
		start := time.Now()
		report, err := wikidataImporter.Run(ctx)
		if err != nil {
			log.Printf("[wikidata] Warning: stage completed with errors: %v", err)
		}
		log.Printf("[wikidata] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
		reports = append(reports, report)
	}

	// Stage 2: ECDICT enrichment (existing words only)
	if shouldRun(cfg.pipes, "ecdict") {
		if !shouldRun(cfg.pipes, "wikidata") {
			log.Printf("[ecdict] Wikidata stage disabled. ECDICT will only enrich existing data.")
		}

		knownForms, err := importService.LoadKnownForms(ctx)
		if err != nil {
			return fmt.Errorf("load known forms: %w", err)
		}
		log.Printf("[ecdict] Loaded %d known forms from database", len(knownForms))

		enricher, err := ecdict.NewEnricher(cfg.ecdictURL, cfg.ecdictCacheDir, cfg.ecdictNoCache)
		if err != nil {
			return fmt.Errorf("ECDICT enricher: %w", err)
		}

		if enricher != nil {
			log.Println("\n" + strings.Repeat("=", 80))
			log.Println("STAGE 2: ECDICT Enrichment")
			log.Println(strings.Repeat("=", 80))

			enricher.RegisterKnownForms(knownForms)

			ecdictImporter := ecdict.NewImporter(cfg.batchSize, importService, enricher)
			start := time.Now()
			report, err := ecdictImporter.Run(ctx)
			if err != nil {
				return fmt.Errorf("ECDICT enrichment stage: %w", err)
			}
			log.Printf("[ecdict] Enrichment stage completed in %s\n", time.Since(start).Round(time.Millisecond))
			reports = append(reports, report)
		}
	}

	// Stage 3: Moby Hyphenator Import
	if shouldRun(cfg.pipes, "moby") {
		if _, err := os.Stat(cfg.mobyFile); err != nil {
			if os.IsNotExist(err) {
				log.Printf("[moby] File not found at %s, skipping Moby import", cfg.mobyFile)
			} else {
				return fmt.Errorf("stat moby file: %w", err)
			}
		} else {
			log.Println("\n" + strings.Repeat("=", 80))
			log.Println("STAGE 3: Moby Hyphenator Import")
			log.Println(strings.Repeat("=", 80))

			mobyImporter := moby.NewImporter(cfg.mobyFile, cfg.batchSize, importService)
			start := time.Now()
			report, err := mobyImporter.Run(ctx)
			if err != nil {
				log.Printf("[moby] Warning: stage completed with errors: %v", err)
			}
			log.Printf("[moby] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
			reports = append(reports, report)
		}
	}

	// Print overall summary
	printOverallSummary(reports)

	// Stage 4: Coverage Check
	if shouldRun(cfg.pipes, "coverage") {
		if err := runCoverageCheck(cfg); err != nil {
			return err
		}
	}

	return nil
}

// runCoverageCheck checks wordbook coverage against lemma database
func runCoverageCheck(cfg pipelineConfig) error {
	fmt.Println("\n🔍 Starting Wordbook Coverage Check")
	fmt.Println(strings.Repeat("=", 80))

	// Initialize database connection
	entClient, cleanup, err := initializeEntClient(cfg.databaseURL)
	if err != nil {
		return fmt.Errorf("initialize ent client: %w", err)
	}
	defer cleanup()

	ctx := context.Background()

	// Run coverage check
	results, err := CheckWordbookCoverage(ctx, entClient, cfg.wordbookDir)
	if err != nil {
		return fmt.Errorf("check coverage: %w", err)
	}

	// Print console report
	PrintCoverageReport(results)

	// Save detailed report to file
	if cfg.coverageOutputDir != "" {
		if err := os.MkdirAll(cfg.coverageOutputDir, 0755); err != nil {
			return fmt.Errorf("create output directory: %w", err)
		}

		outputFile := fmt.Sprintf("%s/wordbook_coverage_report.md", cfg.coverageOutputDir)
		if err := SaveUncoveredWordsReport(results, outputFile); err != nil {
			return fmt.Errorf("save report: %w", err)
		}
	}

	return nil
}

// printOverallSummary prints a summary of all import stages
func printOverallSummary(reports []*report.ImportReport) {
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
			reportFile = "reports/ecdict_enrichment_report.json"
		} else if report.StageName == "Moby" {
			reportFile = "reports/moby_import_report.json"
		}
		if reportFile != "" {
			fmt.Printf("  %s: %s\n", report.StageName, reportFile)
		}
	}

	fmt.Println(strings.Repeat("=", 80))
}

func shouldRun(pipes string, stage string) bool {
	if pipes == "*" {
		return true
	}
	for _, p := range strings.Split(pipes, ",") {
		if strings.TrimSpace(p) == stage {
			return true
		}
	}
	return false
}
