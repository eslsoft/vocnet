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

	// Ensure built-in data sources are available (auto-download if configured)
	mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
	if err := mgr.EnsureAvailable(context.Background(), cfg.Pipeline.AutoDownload, "wikidata", "moby", "cefrj"); err != nil {
		logger.Warn("some pipeline data sources unavailable", "error", err)
	}

	// SourceRegistry for unified source management
	registry := pipeline.NewSourceRegistry(logger)

	// --- Built-in providers ---

	// Wikidata (remains as specialized processor due to complex discovery logic)
	var wikidataProvider provider.WikidataProvider
	wikidataReader, err := wikidata.NewReaderWithLogger(datasource.WikidataDataPath(cfg.Pipeline.DataDir), logger)
	if err != nil {
		return nil, fmt.Errorf("wikidata unavailable (run 'vocnet pipeline source download wikidata' first): %w", err)
	}
	wikidataProvider = wikidataReader

	// Moby (built-in SourceProvider)
	mobyReader, err := moby.NewReader(datasource.MobyDataPath(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("Moby unavailable, syllables will not be available", "error", err)
	} else {
		registry.Register(moby.NewSourceProvider(mobyReader))
	}

	// CEFRJ (built-in SourceProvider)
	cefrjReader, err := cefrj.NewReader(datasource.CEFRJDataDir(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("CEFR-J unavailable, lemma CEFR levels will not be available", "error", err)
	} else {
		registry.Register(cefrj.NewSourceProvider(cefrjReader))
	}

	// --- Contrib sources (ECDICT, ConceptNet, WordNet, etc. via JSON-RPC over stdio) ---
	loadContribSources(ctx, cfg, registry, logger)

	// LLM provider (for intellectual stage)
	var llmProvider llm.Provider
	if cfg.LLM.APIKey != "" {
		cacheRepo := repository.NewDistillCacheRepository(entClient)
		llmProvider = llm.NewOpenAIProvider(
			cfg.LLM.BaseURL,
			cfg.LLM.APIKey,
			cfg.LLM.Model,
			cacheRepo,
		)
	} else {
		logger.Warn("LLM not configured, phase 4 (intellectual) will be skipped — set LLM_API_KEY to enable")
	}

	// Build pipeline stages using SourceRegistry + specialized processors
	aggregator := pipeline.NewDataAggregator()
	persistence := pipeline.NewPersistence(lemmaRepo, lexemeRepo, evidenceRepo, relationRepo, snapshotRepo, aggregator, logger)
	validator := pipeline.NewValidator(lemmaRepo, lexemeRepo, logger)

	stages := registry.BuildStages(map[string][]pipeline.Processor{
		"discovery": {
			pipeline.NewWikidataProcessor(wikidataProvider, logger),
			pipeline.NewCategoryInferProcessor(),
		},
		"relational": {
			pipeline.NewWikidataRelationProcessor(wikidataProvider),
		},
		"intellectual": {
			pipeline.NewSenseMappingProcessor(llmProvider, logger),
			pipeline.NewEnrichmentProcessor(llmProvider, logger),
			pipeline.NewScoringProcessor(llmProvider, logger),
		},
		"synthesis": {
			pipeline.NewLemmaSnapshotProcessor(),
		},
	})

	p := pipeline.NewPipeline(stages, validator, persistence, stageRepo, snapshotRepo, lemmaRepo, lexemeRepo, logger)

	// Configure worker pool
	workerCount := cfg.Pipeline.WorkerCount
	if workerCount <= 0 {
		workerCount = 1
	}

	return pipeline.NewWorkerPool(jobRepo, p, logger, pipeline.WorkerPoolConfig{
		WorkerCount: workerCount,
	}), nil
}

// loadContribSources discovers and starts contrib source processes.
func loadContribSources(ctx context.Context, cfg *config.Config, registry *pipeline.SourceRegistry, logger *slog.Logger) {
	contribDir := strings.TrimSpace(cfg.Pipeline.ContribDir)
	contribList := strings.TrimSpace(cfg.Pipeline.ContribList)
	if contribDir == "" || contribList == "" {
		return
	}

	enabled := strings.Split(contribList, ",")
	for _, name := range enabled {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}

		// Look for executable in contrib dir
		execPath := filepath.Join(contribDir, name)
		if _, err := os.Stat(execPath); err != nil {
			// Try common extensions
			found := false
			for _, ext := range []string{".py", ".sh", ""} {
				candidate := execPath + ext
				if _, statErr := os.Stat(candidate); statErr == nil {
					execPath = candidate
					found = true
					break
				}
			}
			if !found {
				logger.Warn("contrib source not found", "name", name, "path", execPath)
				continue
			}
		}

		sp, err := contrib.NewProcessSourceProvider(ctx, execPath, nil, logger)
		if err != nil {
			logger.Warn("failed to start contrib source", "name", name, "error", err)
			continue
		}

		registry.Register(sp)
	}
}
