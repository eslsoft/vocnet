/*
Copyright © 2025 Ambor <saltbo@foxmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
package cmd

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/contrib"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/app"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/collection"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/evaluation"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/integration"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/persist"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/snapshot"
)

// serveCmd represents the serve command
var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start ConnectRPC server (HTTP + gRPC)",
	RunE: func(cmd *cobra.Command, args []string) error {
		container, cleanup, err := app.Initialize()
		if err != nil {
			return fmt.Errorf("init container: %w", err)
		}
		defer cleanup()

		logger := container.Logger
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		// Start pipeline worker pool
		workerPool, err := buildPipelineWorkerPool(ctx, container.Config, container.EntClient, logger)
		if err != nil {
			logger.Warn("pipeline worker disabled", "error", err)
		} else {
			go func() {
				if err := workerPool.Start(ctx); err != nil {
					logger.Error("pipeline worker error", "error", err)
				}
			}()
		}

		// Build server
		srv := container.Server

		// Register prometheus metrics endpoint (metrics are auto-registered by WorkerPool)
		srv.RegisterMetricsHandler(server.MetricsHandler())

		// Run gRPC & HTTP concurrently
		errCh := make(chan error, 2)
		// go func() { errCh <- srv.StartGRPC() }()
		go func() { errCh <- srv.StartHTTP() }()

		// Graceful shutdown
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		select {
		case sig := <-sigCh:
			logger.Info("received shutdown signal", "signal", sig.String())
			cancel() // Stop worker
			if workerPool != nil {
				workerPool.Wait() // Wait for worker pool to finish in-flight jobs
			}
			shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer shutdownCancel()
			_ = srv.Shutdown(shutdownCtx)
			return nil
		case err := <-errCh:
			cancel() // Stop worker
			if workerPool != nil {
				workerPool.Wait() // Wait for worker pool to finish in-flight jobs
			}
			if err != nil {
				return err
			}
			return nil
		}
	},
}

func init() {
	rootCmd.AddCommand(serveCmd)
}

// buildPipelineWorkerPool constructs the Pipeline and WorkerPool from config and ent client.
func buildPipelineWorkerPool(ctx context.Context, cfg *config.Config, entClient *entdb.Client, logger *slog.Logger) (*pipeline.WorkerPool, error) {
	// Repositories
	lemmaRepo := repository.NewLemmaRepository(entClient)
	lexemeRepo := repository.NewLexemeRepository(entClient)
	evidenceRepo := repository.NewEvidenceRepository(entClient)
	stageRepo := repository.NewPipelineStageRepository(entClient)
	relationRepo := repository.NewSemanticRelationRepository(entClient)
	snapshotRepo := repository.NewLemmaSnapshotRepository(entClient)
	jobRepo := repository.NewPipelineJobRepository(entClient)

	// Ensure built-in data sources are available (always auto-downloads if missing)
	downloader := datasource.NewDownloader(cfg.Pipeline.CacheDir, logger)
	mgr := datasource.NewManager(logger)
	mgr.Register(wikidata.NewSource(cfg.Pipeline.DataDir, downloader, logger))
	mgr.Register(moby.NewSource(cfg.Pipeline.DataDir, downloader, logger))
	mgr.Register(cefrj.NewSource(cfg.Pipeline.DataDir, downloader, logger))
	if err := mgr.EnsureAvailable(context.Background(), "wikidata", "moby", "cefrj"); err != nil {
		logger.Warn("some pipeline data sources unavailable", "error", err)
	}

	// SourceRegistry for unified source management
	registry := pipeline.NewSourceRegistry(logger)

	// --- Built-in providers ---

	// Wikidata (remains as specialized processor due to complex discovery logic)
	var wikidataProvider provider.WikidataProvider
	wikidataReader, err := wikidata.NewReaderWithLogger(wikidata.DataPath(cfg.Pipeline.DataDir), logger)
	if err != nil {
		return nil, fmt.Errorf("wikidata unavailable: %w", err)
	}
	wikidataProvider = wikidataReader

	// Moby (built-in SourceProvider)
	mobyReader, err := moby.NewReader(moby.DataPath(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("Moby unavailable, syllables will not be available", "error", err)
	} else {
		registry.Register(moby.NewSourceProvider(mobyReader))
	}

	// CEFRJ (built-in SourceProvider)
	cefrjReader, err := cefrj.NewReader(cefrj.DataDir(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("CEFR-J unavailable, lemma CEFR levels will not be available", "error", err)
	} else {
		registry.Register(cefrj.NewSourceProvider(cefrjReader))
	}

	// --- Contrib sources (ECDICT, ConceptNet, WordNet, etc. via JSON-RPC over stdio) ---
	loadContribSources(ctx, registry, logger)

	// --- LLM Provider (optional, for enrichment) ---
	var llmProvider llm.Provider
	if cfg.LLM.APIKey != "" {
		cacheRepo := repository.NewDistillCacheRepository(entClient)
		llmProvider = llm.NewOpenAIProvider(cfg.LLM.BaseURL, cfg.LLM.APIKey, cfg.LLM.Model, cacheRepo)
		logger.Debug("llm provider initialized", "base_url", cfg.LLM.BaseURL, "model", cfg.LLM.Model)
	}

	// Build pipeline stages using new Phase system
	persistence := persist.NewPersistence(lemmaRepo, lexemeRepo, evidenceRepo, relationRepo, snapshotRepo, logger)
	validator := pipeline.NewValidator(lemmaRepo, lexemeRepo, logger)
	scorer := scoring.NewRuleBasedScorer()
	evaluator := scoring.NewDataEvaluator(scorer, logger)

	// Build stages with new architecture (LLM enrichment is optional)
	stages := buildNewPipelineStages(registry, wikidataProvider, llmProvider, scorer, logger)

	p := pipeline.NewVocnetPipeline(stages, validator, persistence, stageRepo, snapshotRepo, lemmaRepo, lexemeRepo, evaluator, logger)

	// Configure worker pool
	workerCount := cfg.Pipeline.WorkerCount
	if workerCount <= 0 {
		workerCount = 1
	}

	metrics := pipeline.NewPrometheusMetrics()
	return pipeline.NewWorkerPool(jobRepo, p, logger, workerCount, 5*time.Second, metrics), nil
}

// buildNewPipelineStages constructs the new phase-based pipeline architecture.
func buildNewPipelineStages(
	registry *pipeline.SourceRegistry,
	wikidataProvider provider.WikidataProvider,
	llmProvider llm.Provider,
	scorer *scoring.RuleBasedScorer,
	logger *slog.Logger,
) []*pipeline.Stage {
	// Phase 1: Collection (Concurrent data acquisition from all sources)
	collectionProcessors := []pipeline.Processor{
		// Wikidata remains specialized due to complex discovery logic
		// (includes lexeme fetching, forms extraction, relation building, and category inference)
		collection.NewWikidataProcessor(wikidataProvider, logger),
	}

	// Add all registered source providers to collection
	for _, src := range registry.Sources() {
		collectionProcessors = append(collectionProcessors,
			collection.NewGenericSourceProcessor(src, logger))
	}

	collectionStage := pipeline.NewConcurrentStage(
		string(pipeline.PhaseCollection),
		1,
		collectionProcessors...,
	)

	// Phase 1.5: LLM Enrichment (Fill gaps with LLM-generated data)
	// Optional: only runs if LLM provider is configured
	var llmEnrichment *pipeline.Stage
	if llmProvider != nil {
		llmEnrichment = pipeline.NewStage(
			string(pipeline.PhaseCollection), // Still part of collection phase logically
			2,
			collection.NewLLMEnrichmentProcessor(llmProvider, logger),
		)
	}

	// Phase 2: Evaluation (Quality scoring of fragments)
	evaluationStage := pipeline.NewStage(
		string(pipeline.PhaseEvaluation),
		3,
		evaluation.NewFragmentEvaluator(scorer, logger),
	)

	// Phase 3: Integration (Smart merging based on scores)
	integrationStage := pipeline.NewStage(
		string(pipeline.PhaseIntegration),
		4,
		integration.NewIntegrationProcessor(logger),
	)

	// Phase 4: Snapshot (Final snapshot generation)
	snapshotStage := pipeline.NewStage(
		string(pipeline.PhaseSnapshot),
		5,
		snapshot.NewLemmaSnapshotProcessor(),
	)

	stages := []*pipeline.Stage{collectionStage}
	if llmEnrichment != nil {
		stages = append(stages, llmEnrichment)
	}
	stages = append(stages, evaluationStage, integrationStage, snapshotStage)

	return stages
}

// loadContribSources discovers and starts contrib source processes.
// Scans the contrib/sources directory for executable files.
func loadContribSources(ctx context.Context, registry *pipeline.SourceRegistry, logger *slog.Logger) {
	contribDir := "contrib/sources"

	entries, err := os.ReadDir(contribDir)
	if err != nil {
		if !os.IsNotExist(err) {
			logger.Warn("failed to read contrib sources directory", "dir", contribDir, "error", err)
		}
		return
	}

	for _, entry := range entries {
		// Skip directories and hidden files
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		// Skip Python source files (not executables)
		if strings.HasSuffix(entry.Name(), ".py") {
			continue
		}

		execPath := filepath.Join(contribDir, entry.Name())

		// Check if file is executable
		info, err := entry.Info()
		if err != nil {
			logger.Warn("failed to get file info", "path", execPath, "error", err)
			continue
		}

		// Unix: check executable bit
		if info.Mode()&0111 == 0 {
			logger.Debug("skipping non-executable file", "path", execPath)
			continue
		}

		logger.Info("loading contrib source", "path", execPath)
		sp, err := contrib.NewProcessSourceProvider(ctx, execPath, nil, logger)
		if err != nil {
			logger.Warn("failed to start contrib source", "path", execPath, "error", err)
			continue
		}

		registry.Register(sp)
	}
}
