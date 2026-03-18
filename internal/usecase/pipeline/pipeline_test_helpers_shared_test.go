//go:build integration || quality

package pipeline_test

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/contrib"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	repo "github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/collection"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/evaluation"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/integration"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/persist"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/snapshot"
	"github.com/stretchr/testify/require"
)

type qualityHarness struct {
	pipeline     *pipeline.VocnetPipeline
	svc          *pipeline.PipelineService
	jobRepo      repository.PipelineJobRepository
	entClient    *entdb.Client
	snapshotRepo repository.LemmaSnapshotRepository
}

func newPipelineQualityHarnessForWordbook(
	t *testing.T,
	cfg *config.Config,
	logger *slog.Logger,
	llmProvider llm.Provider,
	wordbookName string,
	registry *pipeline.SourceRegistry,
	wikidataReader *wikidata.Reader,
) *qualityHarness {
	t.Helper()

	dbPath := resolvePipelineQualityDBPathForWordbook(t, wordbookName)
	require.NoError(t, resetSQLiteDBFiles(dbPath))

	dsn := "file:" + dbPath + "?_fk=1&cache=shared&_busy_timeout=5000"
	rawDB, err := sql.Open("sqlite", dsn)
	require.NoError(t, err)
	_, err = rawDB.Exec("PRAGMA foreign_keys = ON")
	require.NoError(t, err)
	_, err = rawDB.Exec("PRAGMA journal_mode = WAL")
	require.NoError(t, err)
	drv := entsql.OpenDB(dialect.SQLite, rawDB)
	entClient := entdb.NewClient(entdb.Driver(drv))
	require.NoError(t, entClient.Schema.Create(context.Background()))
	t.Cleanup(func() { _ = entClient.Close() })

	lemmaRepo := repo.NewLemmaRepository(entClient)
	lexemeRepo := repo.NewLexemeRepository(entClient)
	evidenceRepo := repo.NewEvidenceRepository(entClient)
	relationRepo := repo.NewSemanticRelationRepository(entClient)
	snapshotRepo := repo.NewLemmaSnapshotRepository(entClient)
	stageRepo := repo.NewPipelineStageRepository(entClient)
	jobRepo := repo.NewPipelineJobRepository(entClient)

	persistence := persist.NewPersistence(lemmaRepo, lexemeRepo, evidenceRepo, relationRepo, snapshotRepo, logger)
	validator := pipeline.NewValidator(logger)

	scorer := scoring.NewRuleBasedScorer()
	stages := buildQualityTestStages(registry, wikidataReader, llmProvider, scorer, logger)

	evaluator := scoring.NewDataEvaluator(scorer, logger)
	p := pipeline.NewVocnetPipeline(stages, validator, persistence, stageRepo, snapshotRepo, lemmaRepo, lexemeRepo, evaluator, logger)

	svc := pipeline.NewPipelineService(jobRepo, stageRepo, logger)
	svc.SetLemmaResolver(wikidata.NewLemmaResolver(wikidataReader))

	return &qualityHarness{pipeline: p, svc: svc, jobRepo: jobRepo, entClient: entClient, snapshotRepo: snapshotRepo}
}

func buildQualityTestStages(
	registry *pipeline.SourceRegistry,
	wikidataProvider provider.WikidataProvider,
	llmProvider llm.Provider,
	scorer *scoring.RuleBasedScorer,
	logger *slog.Logger,
) []*pipeline.Stage {
	collectionProcessors := []pipeline.Processor{
		collection.NewWikidataProcessor(wikidataProvider, logger),
	}
	for _, src := range registry.Sources() {
		collectionProcessors = append(collectionProcessors,
			collection.NewGenericSourceProcessor(src, logger))
	}
	collectionStage := pipeline.NewConcurrentStage(
		string(pipeline.PhaseCollection),
		1,
		collectionProcessors...,
	)

	var llmEnrichment *pipeline.Stage
	if llmProvider != nil {
		llmEnrichment = pipeline.NewStage(
			string(pipeline.PhaseCollection),
			2,
			collection.NewLLMEnrichmentProcessor(llmProvider, logger),
		)
	}

	evaluationStage := pipeline.NewStage(
		string(pipeline.PhaseEvaluation),
		3,
		evaluation.NewFragmentEvaluator(scorer, logger),
	)

	integrationStage := pipeline.NewStage(
		string(pipeline.PhaseIntegration),
		4,
		integration.NewIntegrationProcessor(logger),
	)

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

func mustLoadPipelineQualityConfig(t *testing.T) *config.Config {
	t.Helper()

	cfg, err := config.Load()
	require.NoError(t, err)

	if !filepath.IsAbs(cfg.Pipeline.DataDir) {
		repoRoot, findErr := findRepoRoot(t)
		require.NoError(t, findErr)
		cfg.Pipeline.DataDir = filepath.Join(repoRoot, cfg.Pipeline.DataDir)
	}

	if custom := strings.TrimSpace(os.Getenv("PIPELINE_IT_DATA_DIR")); custom != "" {
		if !filepath.IsAbs(custom) {
			repoRoot, findErr := findRepoRoot(t)
			require.NoError(t, findErr)
			custom = filepath.Join(repoRoot, custom)
		}
		cfg.Pipeline.DataDir = custom
	}
	return cfg
}

func requirePipelineSources(t *testing.T, cfg *config.Config, logger *slog.Logger) {
	t.Helper()

	downloader := datasource.NewDownloader(cfg.Pipeline.CacheDir, logger)
	mgr := datasource.NewManager(logger)
	mgr.Register(wikidata.NewSource(cfg.Pipeline.DataDir, downloader, logger))
	mgr.Register(moby.NewSource(cfg.Pipeline.DataDir, downloader, logger))
	mgr.Register(cefrj.NewSource(cfg.Pipeline.DataDir, downloader, logger))

	err := mgr.EnsureAvailable(context.Background(), "wikidata", "moby", "cefrj")
	if err != nil {
		t.Skipf("pipeline quality integration requires local data sources under %s: %v", cfg.Pipeline.DataDir, err)
	}
}

func findRepoRoot(t *testing.T) (string, error) {
	if t != nil {
		t.Helper()
	}

	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("go.mod not found from cwd %s", dir)
		}
		dir = parent
	}
}

func resolvePipelineQualityDBPath(t *testing.T) string {
	t.Helper()

	if custom := strings.TrimSpace(os.Getenv("PIPELINE_IT_DB_PATH")); custom != "" {
		if filepath.IsAbs(custom) {
			return custom
		}
		repoRoot, err := findRepoRoot(t)
		require.NoError(t, err)
		return filepath.Join(repoRoot, custom)
	}

	repoRoot, err := findRepoRoot(t)
	require.NoError(t, err)
	return filepath.Join(repoRoot, "data", "integration", "pipeline-quality-integration.db")
}

func resolvePipelineQualityDBPathForWordbook(t *testing.T, wordbookName string) string {
	t.Helper()

	baseDir := filepath.Dir(resolvePipelineQualityDBPath(t))
	safeName := strings.ReplaceAll(strings.ToLower(wordbookName), " ", "-")
	return filepath.Join(baseDir, fmt.Sprintf("pipeline-quality-%s.db", safeName))
}

func resetSQLiteDBFiles(dbPath string) error {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create db dir: %w", err)
	}

	for _, p := range []string{dbPath, dbPath + "-wal", dbPath + "-shm"} {
		if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove %s: %w", p, err)
		}
	}
	return nil
}

type runWordResult struct {
	Score        float64
	LemmaSurface string
	Variants     []string
}

func (h *qualityHarness) runWord(ctx context.Context, term string) (*runWordResult, error) {
	jobs, err := h.svc.SubmitJob(ctx, term, "en", 2, "")
	if err != nil {
		return nil, fmt.Errorf("submit %q: %w", term, err)
	}

	var lastResult *pipeline.ProcessWordResult
	for _, job := range jobs {
		if err := h.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusRunning, ""); err != nil {
			return nil, fmt.Errorf("mark job running: %w", err)
		}
		result, err := h.pipeline.Run(ctx, job.ID, job.Term, "en", 2, nil)
		if err != nil {
			_ = h.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, err.Error())
			return nil, err
		}
		_ = h.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, "")
		lastResult = result
	}

	if lastResult == nil || lastResult.LemmaSnapshot == nil {
		return nil, fmt.Errorf("snapshot missing for term %q", term)
	}
	lemmaSurface := ""
	if lastResult.Lemma != nil {
		lemmaSurface = lastResult.Lemma.Surface
	}
	return &runWordResult{
		Score:        lastResult.LemmaSnapshot.Quality.Overall,
		LemmaSurface: lemmaSurface,
		Variants:     lastResult.LemmaSnapshot.Variants,
	}, nil
}

// loadTestContribSources discovers and starts contrib source processes for testing.
func loadTestContribSources(ctx context.Context, registry *pipeline.SourceRegistry, logger *slog.Logger) {
	contribDir := "contrib/sources"
	startTime := time.Now()

	repoRoot, err := findRepoRoot(nil)
	if err == nil {
		contribDir = filepath.Join(repoRoot, contribDir)
		absDataDir := filepath.Join(repoRoot, "data")
		os.Setenv("PIPELINE_DATA_DIR", absDataDir)
	}

	logger.Debug("discovering contrib sources", "dir", contribDir)

	entries, err := os.ReadDir(contribDir)
	if err != nil {
		if !os.IsNotExist(err) {
			logger.Warn("failed to read contrib sources directory", "dir", contribDir, "error", err)
		}
		return
	}

	loadedCount := 0
	var loadedNames []string
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		if strings.HasSuffix(entry.Name(), ".py") {
			continue
		}

		execPath := filepath.Join(contribDir, entry.Name())

		info, err := entry.Info()
		if err != nil {
			logger.Warn("failed to get file info", "path", execPath, "error", err)
			continue
		}

		if info.Mode()&0111 == 0 {
			continue
		}

		sp, err := contrib.NewProcessSourceProvider(ctx, execPath, nil, logger)
		if err != nil {
			logger.Warn("failed to start contrib source", "path", execPath, "error", err)
			continue
		}

		registry.Register(sp)
		loadedCount++
		loadedNames = append(loadedNames, sp.Manifest().Name)
	}

	totalElapsed := time.Since(startTime)
	fmt.Fprintf(os.Stderr, "[quality] contrib sources loaded: %d (%s) in %v\n",
		loadedCount, strings.Join(loadedNames, ", "), totalElapsed)
}
