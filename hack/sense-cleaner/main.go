package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

type config struct {
	databaseURL    string
	apiKey         string
	batchSize      int
	limit          int
	offset         int
	dryRun         bool
	languageFilter string
	posFilter      string
	wordbookName   string
	wordbookID     int64
	outputReport   string
}

func main() {
	cfg := parseFlags()

	if err := run(cfg); err != nil {
		log.Fatalf("sense cleaner failed: %v", err)
	}
}

func parseFlags() config {
	var cfg config

	flag.StringVar(&cfg.databaseURL, "database", "", "Database connection URL (or set DATABASE_URL env)")
	flag.StringVar(&cfg.apiKey, "api-key", "", "OpenAI API key (or set OPENAI_API_KEY env)")
	flag.IntVar(&cfg.batchSize, "batch-size", 10, "Number of lexemes to process in parallel")
	flag.IntVar(&cfg.limit, "limit", 0, "Limit number of lexemes to process (0 = all)")
	flag.IntVar(&cfg.offset, "offset", 0, "Start offset in wordbook terms (0-based)")
	flag.BoolVar(&cfg.dryRun, "dry-run", false, "Preview changes without updating database")
	flag.StringVar(&cfg.languageFilter, "language", "", "Filter by language code (e.g., en)")
	flag.StringVar(&cfg.posFilter, "pos", "", "Filter by part of speech (e.g., verb)")
	flag.StringVar(&cfg.wordbookName, "wordbook", "CEFR-B1", "Wordbook name (partial match, case-insensitive)")
	flag.Int64Var(&cfg.wordbookID, "wordbook-id", 0, "Wordbook ID (overrides --wordbook)")
	flag.StringVar(&cfg.outputReport, "output", "reports/sense_cleaning_report.json", "Output report path")

	flag.Parse()

	// Get database URL from environment if not set
	if cfg.databaseURL == "" {
		cfg.databaseURL = os.Getenv("DATABASE_URL")
		if cfg.databaseURL == "" {
			cfg.databaseURL = "file:./data/vocnet.db?_fk=1"
		}
	}

	// Get API key from environment if not set
	if cfg.apiKey == "" {
		cfg.apiKey = os.Getenv("OPENAI_API_KEY")
		if cfg.apiKey == "" {
			log.Fatal("API key required: set --api-key flag or OPENAI_API_KEY environment variable")
		}
	}

	return cfg
}

func run(cfg config) error {
	ctx := context.Background()

	// Initialize database
	log.Printf("Connecting to database: %s", cfg.databaseURL)
	entClient, cleanup, err := initializeEntClient(cfg.databaseURL)
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	defer cleanup()

	// Initialize OpenAI API client
	openAIClient := NewOpenAIClient(cfg.apiKey)

	// Initialize cleaner
	cleaner := NewSenseCleaner(entClient, openAIClient, cfg)

	// Run cleaning process
	log.Printf("Starting sense cleaning process...")
	if cfg.dryRun {
		log.Printf("🔍 DRY RUN MODE - No changes will be made to database")
	}

	report, err := cleaner.Run(ctx)
	if err != nil {
		return fmt.Errorf("cleaning process: %w", err)
	}

	// Save report
	if err := saveReport(report, cfg.outputReport); err != nil {
		return fmt.Errorf("save report: %w", err)
	}

	// Print summary
	printSummary(report, cfg)

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

	client := entdb.NewClient(entdb.Driver(drv))

	cleanup := func() {
		if err := client.Close(); err != nil {
			log.Printf("Warning: failed to close database: %v", err)
		}
	}

	return client, cleanup, nil
}

func saveReport(report *CleaningReport, outputPath string) error {
	// Ensure reports directory exists
	dir := strings.TrimSuffix(outputPath, "/"+strings.Split(outputPath, "/")[len(strings.Split(outputPath, "/"))-1])
	if dir != "" && dir != outputPath {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create report directory: %w", err)
		}
	}

	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal report: %w", err)
	}

	if err := os.WriteFile(outputPath, data, 0644); err != nil {
		return fmt.Errorf("write report: %w", err)
	}

	log.Printf("📄 Report saved to: %s", outputPath)
	return nil
}

func printSummary(report *CleaningReport, cfg config) {
	fmt.Println("\n" + strings.Repeat("=", 80))
	fmt.Println("📊 SENSE CLEANING SUMMARY")
	fmt.Println(strings.Repeat("=", 80))

	fmt.Printf("\n⏱️  Duration: %s\n", report.Duration)
	fmt.Printf("📝 Total Processed: %d\n", report.TotalProcessed)
	fmt.Printf("✅ Successfully Cleaned: %d\n", report.SuccessfullyCleaned)
	fmt.Printf("⏭️  Skipped (no change): %d\n", report.Skipped)
	fmt.Printf("❌ Failed: %d\n", report.Failed)

	if report.SuccessfullyCleaned > 0 {
		fmt.Printf("\n📉 Deduplication Statistics:\n")
		fmt.Printf("  Senses before: %d\n", report.SensesBefore)
		fmt.Printf("  Senses after: %d\n", report.SensesAfter)
		fmt.Printf("  Senses removed: %d (%.1f%% reduction)\n",
			report.SensesBefore-report.SensesAfter,
			float64(report.SensesBefore-report.SensesAfter)/float64(report.SensesBefore)*100)
	}

	if len(report.Examples) > 0 {
		fmt.Printf("\n📖 Sample Changes:\n")
		for i, example := range report.Examples {
			if i >= 3 {
				break
			}
			fmt.Printf("\n  %d. Lemma: %s (POS: %s)\n", i+1, example.Lemma, example.POS)
			if example.BeforeGloss != "" || example.AfterGloss != "" {
				fmt.Printf("     Gloss before: %q\n", example.BeforeGloss)
				fmt.Printf("     Gloss after:  %q\n", example.AfterGloss)
			}
			fmt.Printf("     Senses before: %d\n", len(example.Before))
			fmt.Printf("     Senses after:  %d\n", len(example.After))
		}
	}

	if len(report.Errors) > 0 {
		fmt.Printf("\n⚠️  Errors:\n")
		for i, err := range report.Errors {
			if i >= 5 {
				fmt.Printf("   ... and %d more errors\n", len(report.Errors)-5)
				break
			}
			fmt.Printf("  - %s\n", err)
		}
	}

	if cfg.dryRun {
		fmt.Println("\n🔍 DRY RUN COMPLETED - No changes were made to the database")
	}

	fmt.Println(strings.Repeat("=", 80))
}

type CleaningReport struct {
	StartTime           time.Time         `json:"start_time"`
	EndTime             time.Time         `json:"end_time"`
	Duration            string            `json:"duration"`
	TotalProcessed      int               `json:"total_processed"`
	SuccessfullyCleaned int               `json:"successfully_cleaned"`
	Skipped             int               `json:"skipped"`
	Failed              int               `json:"failed"`
	SensesBefore        int               `json:"senses_before"`
	SensesAfter         int               `json:"senses_after"`
	Examples            []CleaningExample `json:"examples"`
	Errors              []string          `json:"errors"`
	Config              map[string]any    `json:"config"`
}

type CleaningExample struct {
	LexemeID    string               `json:"lexeme_id"`
	Lemma       string               `json:"lemma"`
	POS         string               `json:"pos"`
	BeforeGloss string               `json:"before_gloss"`
	AfterGloss  string               `json:"after_gloss"`
	Before      []entity.LexemeSense `json:"before"`
	After       []entity.LexemeSense `json:"after"`
}
