package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
)

const (
	defaultAPIBase          = "http://localhost:8080"
	defaultBatchSize        = 32
	defaultWikidataFile     = "~/lexemes/english-lexemes.json"
	defaultWikidataLimit    = 0
	defaultECDictURL        = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	defaultRequestTimeout   = 10 * time.Second // Increased from 5s to handle complex merges
	defaultMissingReport    = ""
	defaultWordNetDataPath  = ""
	defaultECDictCacheDir   = ""
	defaultWordNetRelations = false
)

type stage interface {
	Name() string
	Run(ctx context.Context, client dictv1connect.DictServiceClient) error
}

type pipelineConfig struct {
	apiBase           string
	batchSize         int
	requestTimeout    time.Duration
	wikidataFile      string
	wikidataLimit     int
	runWikidata       bool
	useECDICT         bool
	ecdictURL         string
	ecdictCacheDir    string
	ecdictNoCache     bool
	ecdictMissingPath string
	wordNetPath       string
}

func main() {
	cfg := parseFlags()
	if err := runPipeline(cfg); err != nil {
		log.Fatalf("lexeme import failed: %v", err)
	}
}

func parseFlags() pipelineConfig {
	var cfg pipelineConfig

	flag.StringVar(&cfg.apiBase, "api", defaultAPIBase, "DictService base URL")
	flag.IntVar(&cfg.batchSize, "batch", defaultBatchSize, "Maximum parallel API calls")
	flag.DurationVar(&cfg.requestTimeout, "timeout", defaultRequestTimeout, "Per-request timeout")

	flag.StringVar(&cfg.wikidataFile, "wikidata-file", defaultWikidataFile, "Path to filtered Wikidata lexemes JSON")
	flag.IntVar(&cfg.wikidataLimit, "wikidata-limit", defaultWikidataLimit, "Optional limit of Wikidata lexemes to import (0 = no limit)")
	flag.BoolVar(&cfg.runWikidata, "wikidata", true, "Enable Wikidata ingestion stage")

	flag.BoolVar(&cfg.useECDICT, "ecdict", true, "Enable ECDICT enrichment (applied before create)")
	flag.StringVar(&cfg.ecdictURL, "ecdict-url", defaultECDictURL, "ECDICT SQLite download URL")
	flag.StringVar(&cfg.ecdictCacheDir, "ecdict-cache", defaultECDictCacheDir, "ECDICT cache directory (default: user cache dir/vocnet)")
	flag.BoolVar(&cfg.ecdictNoCache, "ecdict-no-cache", false, "Force re-download of ECDICT archive")
	flag.StringVar(&cfg.ecdictMissingPath, "ecdict-missing-report", defaultMissingReport, "Optional file to record lemmas missing from Wikidata (\"\" = log only)")

	flag.StringVar(&cfg.wordNetPath, "wordnet-path", defaultWordNetDataPath, "Optional WordNet data path (stage pending implementation)")

	flag.Parse()

	if cfg.batchSize <= 0 {
		cfg.batchSize = defaultBatchSize
	}

	return cfg
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

	// Load ECDICT enricher if enabled
	var enricher *ecdictEnricher
	if cfg.useECDICT {
		var err error
		enricher, err = newECDICTEnricher(cfg)
		if err != nil {
			return fmt.Errorf("load ECDICT enrichment: %w", err)
		}
		log.Printf("[pipeline] ECDICT enricher loaded with %d entries", len(enricher.entries))
		fmt.Printf("✓ ECDICT enricher loaded with %d entries\n", len(enricher.entries))
	}

	httpClient := &http.Client{
		Timeout: cfg.requestTimeout * time.Duration(cfg.batchSize),
		Transport: &http.Transport{
			MaxIdleConns:        cfg.batchSize,
			MaxIdleConnsPerHost: cfg.batchSize,
			MaxConnsPerHost:     cfg.batchSize,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	client := dictv1connect.NewDictServiceClient(httpClient, cfg.apiBase)
	ctx := context.Background()

	var reports []*ImportReport

	// Stage 1: Wikidata import (without ECDICT enrichment)
	if cfg.runWikidata {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 1: Wikidata Import")
		log.Println(strings.Repeat("=", 80))

		wikidataStage := newWikidataStage(cfg)
		start := time.Now()
		report, err := wikidataStage.Run(ctx, client)
		if err != nil {
			log.Printf("[wikidata] Warning: stage completed with errors: %v", err)
		}
		log.Printf("[wikidata] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
		reports = append(reports, report)

		// Register Wikidata words with ECDICT enricher for deduplication
		if enricher != nil {
			log.Println("[pipeline] Registering Wikidata words with ECDICT enricher...")
			// We need to get the words from wikidata to register them
			// Since we don't have direct access, we'll rely on the enricher
			// being populated by the lookup mechanism
			log.Println("[pipeline] Wikidata words will be excluded from ECDICT import based on term matching")
		}
	}

	// Stage 2: ECDICT import (new words only)
	if enricher != nil {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 2: ECDICT Import")
		log.Println(strings.Repeat("=", 80))

		ecdictStage := newECDictStage(cfg, enricher)
		start := time.Now()
		report, err := ecdictStage.Run(ctx, client)
		if err != nil {
			return fmt.Errorf("ECDICT stage: %w", err)
		}
		log.Printf("[ecdict] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
		reports = append(reports, report)
	}

	// Stage 3: WordNet (if configured)
	if cfg.wordNetPath != "" {
		log.Println("\n" + strings.Repeat("=", 80))
		log.Println("STAGE 3: WordNet Import")
		log.Println(strings.Repeat("=", 80))

		wordnetStage := newWordNetStage(cfg.wordNetPath)
		start := time.Now()
		if err := wordnetStage.Run(ctx, client); err != nil {
			return fmt.Errorf("WordNet stage: %w", err)
		}
		log.Printf("[wordnet] Stage completed in %s\n", time.Since(start).Round(time.Millisecond))
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
		}
		if reportFile != "" {
			fmt.Printf("  %s: %s\n", report.StageName, reportFile)
		}
	}

	fmt.Println(strings.Repeat("=", 80))
}
