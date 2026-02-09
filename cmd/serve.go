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
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/eslsoft/vocnet/internal/adapter/mapping"
	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/conceptnet"
	"github.com/eslsoft/vocnet/internal/adapter/provider/ecdict"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wordnet"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/app"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/pkg/safeconv"
	"github.com/eslsoft/vocnet/pkg/wordbook"
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

		if err := syncBuiltinWordbooks(ctx, container); err != nil {
			return fmt.Errorf("sync builtin wordbooks: %w", err)
		}

		// Start pipeline worker pool
		workerPool, err := buildPipelineWorkerPool(container.Config, container.EntClient, logger)
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

	// Here you will define your flags and configuration settings.

	// Cobra supports Persistent Flags which will work for this command
	// and all subcommands, e.g.:
	// serveCmd.PersistentFlags().String("foo", "", "A help for foo")

	// Cobra supports local flags which will only run when this command
	// is called directly, e.g.:
	// serveCmd.Flags().BoolP("toggle", "t", false, "Help message for toggle")
}

func syncBuiltinWordbooks(ctx context.Context, container *app.Container) error {
	builtin := wordbook.GetBuiltinWordbooks()
	books := make([]*entity.Wordbook, 0, len(builtin))
	for idx, wb := range builtin {
		ent := mapping.ToEntityWordbook(wb)
		if ent == nil {
			continue
		}
		ent.Source = entity.WordbookSourceBuiltin
		ent.SortOrder = safeconv.IntToInt32(idx + 1)
		books = append(books, ent)
	}
	return container.WordbookUsecase.SyncBuiltin(ctx, books)
}

// buildPipelineWorkerPool constructs the Pipeline and WorkerPool from config and ent client.
func buildPipelineWorkerPool(cfg *config.Config, entClient *entdb.Client, logger *slog.Logger) (*pipeline.WorkerPool, error) {
	// Repositories
	lemmaRepo := repository.NewLemmaRepository(entClient)
	lexemeRepo := repository.NewLexemeRepository(entClient)
	evidenceRepo := repository.NewEvidenceRepository(entClient)
	taskRepo := repository.NewPipelineTaskRepository(entClient)
	relationRepo := repository.NewSemanticRelationRepository(entClient)
	snapshotRepo := repository.NewWordSnapshotRepository(entClient)
	jobRepo := repository.NewPipelineJobRepository(entClient)

	// Ensure data sources are available (auto-download if configured)
	mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
	if err := mgr.EnsureAvailable(context.Background(), cfg.Pipeline.AutoDownload, "conceptnet", "ecdict", "wordnet", "moby", "wikidata", "cefrj"); err != nil {
		logger.Warn("some pipeline data sources unavailable", "error", err)
	}

	// Providers
	var wikidataProvider provider.WikidataProvider
	wikidataReader, err := wikidata.NewReaderWithLogger(datasource.WikidataDataPath(cfg.Pipeline.DataDir), logger)
	if err != nil {
		return nil, fmt.Errorf("wikidata unavailable (run 'vocnet pipeline source download wikidata' first): %w", err)
	}
	wikidataProvider = wikidataReader

	var conceptnetProvider provider.ConceptNetProvider
	conceptnetReader, err := conceptnet.NewReaderWithLogger(datasource.ConceptNetDataPath(cfg.Pipeline.DataDir), logger)
	if err != nil {
		return nil, fmt.Errorf("conceptnet unavailable (run 'vocnet pipeline source download conceptnet' first): %w", err)
	}
	conceptnetProvider = conceptnetReader

	var ecdictReader *ecdict.Reader
	ecdictReader, err = ecdict.NewReader(datasource.ECDICTDataPath(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("ECDICT unavailable, Phase 2 will be skipped", "error", err)
	}

	wordnetReader := wordnet.NewReader(datasource.WordNetDataDir(cfg.Pipeline.DataDir))

	var mobyReader *moby.Reader
	mobyReader, err = moby.NewReader(datasource.MobyDataPath(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("Moby unavailable, syllables will not be available", "error", err)
	}

	var cefrjReader *cefrj.Reader
	cefrjReader, err = cefrj.NewReader(datasource.CEFRJDataDir(cfg.Pipeline.DataDir))
	if err != nil {
		logger.Warn("CEFR-J unavailable, lemma CEFR levels will not be available", "error", err)
	}

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

	// Build pipeline
	aggregator := pipeline.NewDataAggregator()
	persistence := pipeline.NewPersistence(lemmaRepo, lexemeRepo, evidenceRepo, relationRepo, snapshotRepo, aggregator, logger)
	validator := pipeline.NewValidator(lemmaRepo, lexemeRepo, logger)

	stages := []*pipeline.Stage{
		pipeline.NewStage("discovery", 1,
			pipeline.NewWikidataProcessor(wikidataProvider, logger),
			pipeline.NewCategoryInferProcessor(),
		),
		pipeline.NewStage("lexical", 2,
			pipeline.NewCEFRJProcessor(cefrjReader),
			pipeline.NewECDICTProcessor(ecdictReader),
			pipeline.NewMobyProcessor(mobyReader),
		),
		pipeline.NewStage("relational", 3,
			pipeline.NewConceptNetProcessor(conceptnetProvider),
			pipeline.NewWikidataRelationProcessor(wikidataProvider),
			pipeline.NewWordNetProcessor(wordnetReader),
		),
		pipeline.NewStage("intellectual", 4,
			pipeline.NewSenseMappingProcessor(llmProvider, logger),
			pipeline.NewEnrichmentProcessor(llmProvider, logger),
			pipeline.NewScoringProcessor(llmProvider, logger),
		),
		pipeline.NewStage("synthesis", 5,
			pipeline.NewSnapshotProcessor(),
		),
	}

	p := pipeline.NewPipeline(stages, validator, persistence, taskRepo, snapshotRepo, lemmaRepo, lexemeRepo, logger)

	// Configure worker pool
	workerCount := cfg.Pipeline.WorkerCount
	if workerCount <= 0 {
		workerCount = 1
	}

	return pipeline.NewWorkerPool(jobRepo, p, logger, pipeline.WorkerPoolConfig{
		WorkerCount: workerCount,
	}), nil
}
