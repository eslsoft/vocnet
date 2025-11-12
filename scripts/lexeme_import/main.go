package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
)

const (
	defaultAPIBase          = "http://localhost:8080"
	defaultBatchSize        = 32
	defaultWikidataFile     = "~/lexemes/english-lexemes.json"
	defaultWikidataLimit    = 0
	defaultECDictURL        = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
	defaultRequestTimeout   = 5 * time.Second
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
	log.SetOutput(os.Stdout)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	var enricher *ecdictEnricher
	if cfg.useECDICT {
		var err error
		enricher, err = newECDICTEnricher(cfg)
		if err != nil {
			return fmt.Errorf("load ECDICT enrichment: %w", err)
		}
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

	var stages []stage
	if cfg.runWikidata {
		stages = append(stages, newWikidataStage(cfg, enricher))
	}
	if cfg.wordNetPath != "" {
		stages = append(stages, newWordNetStage(cfg.wordNetPath))
	}

	if len(stages) == 0 {
		return fmt.Errorf("no stages enabled; use -wikidata or -ecdict or provide -wordnet-path")
	}

	ctx := context.Background()
	for idx, st := range stages {
		log.Printf("[%d/%d] starting %s stage", idx+1, len(stages), st.Name())
		start := time.Now()
		if err := st.Run(ctx, client); err != nil {
			return fmt.Errorf("%s stage: %w", st.Name(), err)
		}
		log.Printf("[%s] completed in %s", st.Name(), time.Since(start).Round(time.Millisecond))
	}

	// After all stages, import ECDICT-only words
	if enricher != nil {
		if err := importECDICTOnlyWords(ctx, client, enricher, cfg); err != nil {
			return fmt.Errorf("import ECDICT-only words: %w", err)
		}
		enricher.ReportUnused()
	}
	return nil
}

func importECDICTOnlyWords(ctx context.Context, client dictv1connect.DictServiceClient, enricher *ecdictEnricher, cfg pipelineConfig) error {
	log.Printf("[ecdict-import] extracting words missing from Wikidata...")
	toImport, skipped := enricher.GetMissingWords()

	log.Printf("[ecdict-import] found %d words to import, %d skipped", len(toImport), len(skipped))

	if len(toImport) == 0 {
		log.Printf("[ecdict-import] no words to import")
		return reportSkippedWords(skipped, cfg.ecdictMissingPath)
	}

	// Import words in batches
	imported := 0
	failed := 0
	sem := make(chan struct{}, cfg.batchSize)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, word := range toImport {
		wg.Add(1)
		sem <- struct{}{}

		go func(idx int, w *dictv1.Word) {
			defer wg.Done()
			defer func() { <-sem }()

			req := &dictv1.CreateWordRequest{Word: w}
			_, err := client.CreateWord(ctx, connect.NewRequest(req))

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed++
				if failed <= 5 {
					log.Printf("[ecdict-import] failed to create word %q: %v", w.GetLemma(), err)
				}
			} else {
				imported++
				if (idx+1)%100 == 0 || idx+1 == len(toImport) {
					log.Printf("[ecdict-import] progress: %d/%d imported", imported, len(toImport))
				}
			}
		}(i, word)
	}

	wg.Wait()
	log.Printf("[ecdict-import] completed: %d imported, %d failed", imported, failed)

	return reportSkippedWords(skipped, cfg.ecdictMissingPath)
}

func reportSkippedWords(skipped []skippedWordEntry, reportPath string) error {
	if len(skipped) == 0 {
		return nil
	}

	// Group by reason
	byReason := make(map[string]int)
	for _, entry := range skipped {
		byReason[entry.reason]++
	}

	log.Printf("[ecdict-import] skipped words by reason:")
	for reason, count := range byReason {
		log.Printf("  - %s: %d", reason, count)
	}

	if reportPath == "" {
		// Just log first few
		show := skipped
		if len(show) > 10 {
			show = show[:10]
		}
		for _, entry := range show {
			log.Printf("[ecdict-import] skipped %q (reason: %s)", entry.word, entry.reason)
		}
		if len(skipped) > len(show) {
			log.Printf("[ecdict-import] ... plus %d more (set -ecdict-missing-report to persist)", len(skipped)-len(show))
		}
		return nil
	}

	// Sort by reason, then word
	sort.Slice(skipped, func(i, j int) bool {
		if skipped[i].reason != skipped[j].reason {
			return skipped[i].reason < skipped[j].reason
		}
		return skipped[i].word < skipped[j].word
	})

	path, err := expandHome(reportPath)
	if err != nil {
		return fmt.Errorf("resolve report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create report dir: %w", err)
	}

	// Build TSV output with header
	var builder strings.Builder
	builder.WriteString("word\treason\ttranslation\texchange\n")
	for _, entry := range skipped {
		translation := strings.ReplaceAll(strings.ReplaceAll(entry.translation, "\t", " "), "\n", " ")
		exchange := strings.ReplaceAll(strings.ReplaceAll(entry.exchange, "\t", " "), "\n", " ")
		builder.WriteString(fmt.Sprintf("%s\t%s\t%s\t%s\n", entry.word, entry.reason, translation, exchange))
	}

	if err := os.WriteFile(path, []byte(builder.String()), 0o644); err != nil {
		return fmt.Errorf("write skipped report: %w", err)
	}

	log.Printf("[ecdict-import] wrote %d skipped words to %s", len(skipped), path)
	return nil
}
