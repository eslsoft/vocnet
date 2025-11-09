package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

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
	if enricher != nil {
		enricher.ReportUnused()
	}
	return nil
}
