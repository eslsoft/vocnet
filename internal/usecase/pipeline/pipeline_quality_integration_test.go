//go:build integration

package pipeline

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	repo "github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/pkg/wordbook"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

func TestPipelineDataQualityGates(t *testing.T) {
	ctx := context.Background()
	cfg := mustLoadPipelineQualityConfig(t)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))

	requirePipelineSources(t, cfg, logger)

	t.Run("raw_without_llm", func(t *testing.T) {
		h := newPipelineQualityHarness(t, cfg, logger, nil)
		runRawQualityStages(t, ctx, h)
	})

	t.Run("llm_cleaned", func(t *testing.T) {
		t.Skip("LLM 清洗阶段已设计，按当前要求先跳过。后续可在提供 PIPELINE_LLM_API_KEY 后启用。")

		provider := newOpenAIProviderFromEnv(t, cfg)
		h := newPipelineQualityHarness(t, cfg, logger, provider)
		runLLMCleanedQualityStages(t, ctx, h)
	})
}

type qualityHarness struct {
	pipeline *Pipeline
	jobRepo  repository.PipelineJobRepository
}

func newPipelineQualityHarness(t *testing.T, cfg *config.Config, logger *slog.Logger, llmProvider llm.Provider) *qualityHarness {
	t.Helper()

	wikidataReader, err := wikidata.NewReaderWithLogger(datasource.WikidataDataPath(cfg.Pipeline.DataDir), logger)
	require.NoError(t, err)
	t.Cleanup(func() { _ = wikidataReader.Close() })

	mobyReader, err := moby.NewReader(datasource.MobyDataPath(cfg.Pipeline.DataDir))
	require.NoError(t, err)
	t.Cleanup(func() { _ = mobyReader.Close() })

	cefrjReader, err := cefrj.NewReader(datasource.CEFRJDataDir(cfg.Pipeline.DataDir))
	require.NoError(t, err)

	dbPath := resolvePipelineQualityDBPath(t)
	require.NoError(t, resetSQLiteDBFiles(dbPath))
	t.Logf("[quality] using integration db: %s", dbPath)

	dsn := "file:" + dbPath + "?_fk=1&cache=shared"
	rawDB, err := sql.Open("sqlite", dsn)
	require.NoError(t, err)
	_, err = rawDB.Exec("PRAGMA foreign_keys = ON")
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

	aggregator := NewDataAggregator()
	persistence := NewPersistence(lemmaRepo, lexemeRepo, evidenceRepo, relationRepo, snapshotRepo, aggregator, logger)
	validator := NewValidator(lemmaRepo, lexemeRepo, logger)

	// Use SourceRegistry for built-in sources
	registry := NewSourceRegistry(logger)
	registry.Register(moby.NewSourceProvider(mobyReader))
	registry.Register(cefrj.NewSourceProvider(cefrjReader))

	stages := registry.BuildStages(map[string][]Processor{
		"discovery": {
			NewWikidataProcessor(wikidataReader, logger),
			NewCategoryInferProcessor(),
		},
		"relational": {
			NewWikidataRelationProcessor(wikidataReader),
		},
		"intellectual": {
			NewSenseMappingProcessor(llmProvider, logger),
			NewEnrichmentProcessor(llmProvider, logger),
			NewScoringProcessor(llmProvider, logger),
		},
		"synthesis": {
			NewLemmaSnapshotProcessor(),
		},
	})

	scorer := NewRuleBasedScorer()
	evaluator := NewDataEvaluator(scorer, logger)
	p := NewPipeline(stages, validator, persistence, stageRepo, snapshotRepo, lemmaRepo, lexemeRepo, evaluator, logger)
	return &qualityHarness{pipeline: p, jobRepo: jobRepo}
}

func (h *qualityHarness) runWord(ctx context.Context, term string) (float64, error) {
	// Create a job for this term
	job, err := h.jobRepo.Create(ctx, &entity.PipelineJob{
		Status:   entity.JobStatusPending,
		Name:     "quality-test-" + term,
		Language: "en",
		Tier:     2,
		Term:     term,
	})
	if err != nil {
		return 0, fmt.Errorf("create job: %w", err)
	}
	if err := h.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusRunning, ""); err != nil {
		return 0, fmt.Errorf("mark job running: %w", err)
	}

	result, err := h.pipeline.Run(ctx, job.ID, term, "en", 2, nil)
	if err != nil {
		_ = h.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusFailed, err.Error())
		return 0, err
	}
	if err := h.jobRepo.UpdateStatus(ctx, job.ID, entity.JobStatusCompleted, ""); err != nil {
		return 0, fmt.Errorf("mark job completed: %w", err)
	}
	if result == nil || result.LemmaSnapshot == nil {
		return 0, fmt.Errorf("snapshot missing")
	}
	return result.LemmaSnapshot.Quality.Overall, nil
}

type stageRequirement struct {
	name            string
	terms           []string
	minScore        float64
	targetScore     float64
	minAverageScore float64
}

type stageReport struct {
	stageName       string
	count           int
	avgScore        float64
	hardFailures    []string
	targetMisses    []string
	executionErrors []string
}

func runRawQualityStages(t *testing.T, ctx context.Context, h *qualityHarness) {
	t.Helper()

	stages := []stageRequirement{
		{
			name:            "common_words_foundation",
			terms:           []string{"apple", "water", "school", "family", "friend", "house", "time", "money", "music", "health"},
			minScore:        65,
			targetScore:     85,
			minAverageScore: 72,
		},
		{
			name:            "common_words_polysemy",
			terms:           []string{"bank", "light", "charge", "match", "table", "spring", "interest", "field", "cell", "key"},
			minScore:        58,
			targetScore:     78,
			minAverageScore: 65,
		},
		{
			name: "pos_parsing_fixes",
			// Words that previously failed due to POS parsing issues:
			// - Wikidata QID mappings: ad (Q134830 prefix), ant (Q134830), ours (Q5051 possessive det),
			//   pan (Q134830), robot (Q468801 personal pronoun), whatever/whether (Q54310231 interrogative pronoun)
			// - "intj" POS string: beauty, bother, damn, face, shoot, set
			// - ECDICT empty POS (should not fail anymore): percent, sports, goods, customs, contents
			// Note: Lower thresholds because these are edge cases with less comprehensive data coverage
			terms:           []string{"ad", "ant", "ours", "pan", "robot", "whatever", "whether", "beauty", "bother", "damn", "face", "shoot", "set", "percent", "sports", "goods", "customs", "contents"},
			minScore:        20,
			targetScore:     50,
			minAverageScore: 45,
		},
	}

	for _, stage := range stages {
		report := runStageAndCollect(t, ctx, h, stage)
		assertStageHardGate(t, report)
	}

	runBuiltinWordbookStage(t, ctx, h, 0)
}

func runLLMCleanedQualityStages(t *testing.T, ctx context.Context, h *qualityHarness) {
	t.Helper()

	stages := []stageRequirement{
		{
			name:            "common_words_foundation_llm",
			terms:           []string{"apple", "water", "school", "family", "friend", "house", "time", "money", "music", "health"},
			minScore:        70,
			targetScore:     88,
			minAverageScore: 76,
		},
		{
			name:            "common_words_polysemy_llm",
			terms:           []string{"bank", "light", "charge", "match", "table", "spring", "interest", "field", "cell", "key"},
			minScore:        62,
			targetScore:     82,
			minAverageScore: 68,
		},
	}

	for _, stage := range stages {
		report := runStageAndCollect(t, ctx, h, stage)
		assertStageHardGate(t, report)
	}

	// LLM 清洗后，词书阶段要求整体额外 +5 分。
	runBuiltinWordbookStage(t, ctx, h, 5)
}

func runStageAndCollect(t *testing.T, ctx context.Context, h *qualityHarness, stage stageRequirement) stageReport {
	t.Helper()

	terms := dedupeTerms(stage.terms)
	scores := make([]float64, 0, len(terms))
	report := stageReport{stageName: stage.name, count: len(terms)}

	for _, term := range terms {
		score, err := h.runWord(ctx, term)
		if err != nil {
			report.executionErrors = append(report.executionErrors, fmt.Sprintf("%s: %v", term, err))
			continue
		}
		scores = append(scores, score)

		if score < stage.minScore {
			report.hardFailures = append(report.hardFailures, fmt.Sprintf("%s=%.2f(<%.2f)", term, score, stage.minScore))
		} else if score < stage.targetScore {
			report.targetMisses = append(report.targetMisses, fmt.Sprintf("%s=%.2f(<%.2f)", term, score, stage.targetScore))
		}
	}

	report.avgScore = average(scores)
	if report.avgScore < stage.minAverageScore {
		report.hardFailures = append(report.hardFailures, fmt.Sprintf("stage_avg=%.2f(<%.2f)", report.avgScore, stage.minAverageScore))
	}

	t.Logf("[quality][%s] terms=%d avg=%.2f hard_failures=%d target_misses=%d exec_errors=%d",
		report.stageName, report.count, report.avgScore, len(report.hardFailures), len(report.targetMisses), len(report.executionErrors))
	if len(report.targetMisses) > 0 {
		t.Logf("[quality][%s] target misses: %s", report.stageName, strings.Join(report.targetMisses, ", "))
	}
	return report
}

func assertStageHardGate(t *testing.T, report stageReport) {
	t.Helper()
	if len(report.executionErrors) > 0 {
		t.Fatalf("stage %s has execution errors: %s", report.stageName, strings.Join(report.executionErrors, "; "))
	}
	if len(report.hardFailures) > 0 {
		t.Fatalf("stage %s hard gate failed: %s", report.stageName, strings.Join(report.hardFailures, "; "))
	}
}

type builtinBookRequirement struct {
	name            string
	minAverageScore float64
	targetAverage   float64
}

var qualityGateTermPattern = regexp.MustCompile(`^[A-Za-z]+$`)

func runBuiltinWordbookStage(t *testing.T, ctx context.Context, h *qualityHarness, llmBoost float64) {
	t.Helper()

	books := selectBuiltinWordbooksForQualityGate(t)
	wordsPerBook := envInt("PIPELINE_IT_WORDS_PER_BOOK", 30)

	for _, req := range books {
		bookTerms, ok := builtinWordbookTerms(req.name)
		require.Truef(t, ok, "builtin wordbook %q not found", req.name)

		filteredTerms := filterWordbookTermsForQualityGate(bookTerms)
		if len(filteredTerms) == 0 {
			t.Fatalf("builtin wordbook %q has no eligible terms after normalization", req.name)
		}

		limit := wordsPerBook
		if limit <= 0 || limit > len(filteredTerms) {
			limit = len(filteredTerms)
		}
		if limit == 0 {
			t.Fatalf("builtin wordbook %q has no terms", req.name)
		}

		terms := dedupeTerms(filteredTerms[:limit])
		scores := make([]float64, 0, len(terms))
		errors := make([]string, 0)

		for _, term := range terms {
			score, err := h.runWord(ctx, term)
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", term, err))
				continue
			}
			scores = append(scores, score)
		}

		require.Emptyf(t, errors, "wordbook %s execution errors: %s", req.name, strings.Join(errors, "; "))

		avgScore := average(scores)
		minAverage := req.minAverageScore + llmBoost
		targetAverage := req.targetAverage + llmBoost
		t.Logf("[quality][wordbook:%s] sampled=%d eligible=%d avg=%.2f required_min=%.2f target=%.2f",
			req.name, len(terms), len(filteredTerms), avgScore, minAverage, targetAverage)

		require.GreaterOrEqualf(t, avgScore, minAverage,
			"wordbook %s average quality score %.2f is below required %.2f", req.name, avgScore, minAverage)

		if avgScore < targetAverage {
			t.Logf("[quality][wordbook:%s] average score %.2f did not reach target %.2f", req.name, avgScore, targetAverage)
		}
	}
}

func filterWordbookTermsForQualityGate(terms []string) []string {
	out := make([]string, 0, len(terms))
	for _, term := range terms {
		v := strings.TrimSpace(term)
		if v == "" {
			continue
		}
		if !qualityGateTermPattern.MatchString(v) {
			continue
		}
		out = append(out, v)
	}
	return out
}

func selectBuiltinWordbooksForQualityGate(t *testing.T) []builtinBookRequirement {
	t.Helper()

	if os.Getenv("PIPELINE_IT_ALL_WORDBOOKS") == "1" {
		books := wordbook.GetBuiltinWordbooks()
		out := make([]builtinBookRequirement, 0, len(books))
		for _, b := range books {
			minAvg, targetAvg := classifyWordbookQualityThreshold(b.Name)
			out = append(out, builtinBookRequirement{name: b.Name, minAverageScore: minAvg, targetAverage: targetAvg})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].name < out[j].name })
		return out
	}

	raw := strings.TrimSpace(os.Getenv("PIPELINE_IT_WORDBOOKS"))
	if raw != "" {
		names := splitCSV(raw)
		out := make([]builtinBookRequirement, 0, len(names))
		for _, name := range names {
			minAvg, targetAvg := classifyWordbookQualityThreshold(name)
			out = append(out, builtinBookRequirement{name: name, minAverageScore: minAvg, targetAverage: targetAvg})
		}
		return out
	}

	// 默认覆盖基础/中阶/高阶词书。
	names := []string{"CEFR-A1", "CEFR-B1", "CEFR-C1", "IELTS", "GRE"}
	out := make([]builtinBookRequirement, 0, len(names))
	for _, name := range names {
		minAvg, targetAvg := classifyWordbookQualityThreshold(name)
		out = append(out, builtinBookRequirement{name: name, minAverageScore: minAvg, targetAverage: targetAvg})
	}
	return out
}

func classifyWordbookQualityThreshold(name string) (minAvg float64, targetAvg float64) {
	n := strings.ToUpper(strings.TrimSpace(name))

	switch {
	case strings.Contains(n, "CEFR-A1"), strings.Contains(n, "CEFR-A2"), strings.Contains(n, "OXFORD 3000"):
		return 70, 85
	case strings.Contains(n, "CEFR-B1"), strings.Contains(n, "CEFR-B2"), strings.Contains(n, "OXFORD 5000"),
		strings.Contains(n, "CET4"), strings.Contains(n, "IELTS"), strings.Contains(n, "TOEFL"), strings.Contains(n, "SAT"):
		return 64, 78
	case strings.Contains(n, "CEFR-C1"), strings.Contains(n, "CEFR-C2"), strings.Contains(n, "CET6"),
		strings.Contains(n, "GRE"), strings.Contains(n, "GMAT"):
		return 57, 72
	default:
		return 62, 75
	}
}

func builtinWordbookTerms(name string) ([]string, bool) {
	for _, b := range wordbook.GetBuiltinWordbooks() {
		if strings.EqualFold(b.Name, name) {
			return b.Terms, true
		}
	}
	return nil, false
}

func requirePipelineSources(t *testing.T, cfg *config.Config, logger *slog.Logger) {
	t.Helper()

	mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
	err := mgr.EnsureAvailable(context.Background(), false, "wikidata", "moby", "cefrj")
	if err != nil {
		t.Skipf("pipeline quality integration requires local data sources under %s: %v", cfg.Pipeline.DataDir, err)
	}
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
		cfg.Pipeline.DataDir = custom
	}
	return cfg
}

func findRepoRoot(t *testing.T) (string, error) {
	t.Helper()

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

func newOpenAIProviderFromEnv(t *testing.T, cfg *config.Config) llm.Provider {
	t.Helper()

	if strings.TrimSpace(cfg.LLM.APIKey) == "" {
		t.Skip("LLM_API_KEY 未设置")
	}

	// NOTE: 这里只返回最小可用 Provider 壳，等 llm_cleaned 阶段启用后再接入缓存仓库。
	// 当前测试已 Skip，不会走到这里。
	return &noopLLMProvider{}
}

type noopLLMProvider struct{}

func (n *noopLLMProvider) Complete(ctx context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error) {
	return nil, fmt.Errorf("noop llm provider")
}

func dedupeTerms(terms []string) []string {
	seen := make(map[string]struct{}, len(terms))
	out := make([]string, 0, len(terms))
	for _, term := range terms {
		v := strings.TrimSpace(term)
		if v == "" {
			continue
		}
		key := strings.ToLower(v)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, v)
	}
	return out
}

func average(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values))
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		v := strings.TrimSpace(p)
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

func envInt(key string, defaultValue int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return defaultValue
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return defaultValue
	}
	return v
}

var _ provider.WikidataProvider = (*wikidata.Reader)(nil)

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
