package cmd

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/conceptnet"
	"github.com/eslsoft/vocnet/internal/adapter/provider/ecdict"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wordnet"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	repositoryiface "github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

// buildPipelineRuntime constructs the pipeline coordinator and repositories needed by orchestration workers.
func buildPipelineRuntime(cfg *config.Config, entClient *entdb.Client, logger *slog.Logger) (*pipeline.Pipeline, repositoryiface.PipelineJobRepository, error) {
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
		return nil, nil, fmt.Errorf("wikidata unavailable (run 'vocnet pipeline source download wikidata' first): %w", err)
	}
	wikidataProvider = wikidataReader

	var conceptnetProvider provider.ConceptNetProvider
	conceptnetReader, err := conceptnet.NewReaderWithLogger(datasource.ConceptNetDataPath(cfg.Pipeline.DataDir), logger)
	if err != nil {
		return nil, nil, fmt.Errorf("conceptnet unavailable (run 'vocnet pipeline source download conceptnet' first): %w", err)
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
	return p, jobRepo, nil
}
