//go:build integration

package pipeline_test

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	apiconnectrpc "github.com/eslsoft/vocnet/internal/adapter/connectrpc"
	repo "github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/usecase"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// TestPipelineToAPI_IrregularAndLemma runs real words through the full pipeline,
// then verifies the API output against known linguistic expectations.
//
// This is a true E2E test: pipeline processes real data sources → writes to DB → API reads from DB.
// It catches bugs like:
// - Regular forms (defined, starting) incorrectly marked irregular
// - Inflected forms missing their lemma reference
// - Snapshot surface set to inflected form instead of base form
func TestPipelineToAPI_IrregularAndLemma(t *testing.T) {
	ctx := context.Background()

	cfg := mustLoadPipelineQualityConfig(t)
	logger := testLogger(t)

	requirePipelineSources(t, cfg, logger)

	// Build a harness with real data sources
	wikidataReader, registry := buildTestSourceRegistry(t, cfg, logger)

	harness := newPipelineQualityHarnessForWordbook(t, cfg, logger, nil, "api-e2e-test", registry, wikidataReader)

	// Run base lemmas through the pipeline first (so inflected forms resolve correctly)
	baseWords := []string{"define", "cover", "limit", "count", "perform", "load", "start", "run", "child", "work", "good"}
	for _, word := range baseWords {
		_, err := harness.runWord(ctx, word)
		if err != nil {
			t.Logf("[e2e] warning: failed to process %q: %v", word, err)
		}
	}

	// Create DictService from the same database
	snapshotRepo := repo.NewLemmaSnapshotRepository(harness.entClient)
	lemmaRepo := repo.NewLemmaRepository(harness.entClient)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := apiconnectrpc.NewDictServiceServer(wordUC)

	// Test cases: lookup various forms and verify API output
	tests := []struct {
		query         string
		wantIrregular bool
		wantLemma     string // expected Lemma value; empty means should be nil (queried word IS the lemma)
	}{
		// Regular forms — MUST NOT be irregular, MUST have correct lemma
		{query: "defined", wantIrregular: false, wantLemma: "define"},
		{query: "covered", wantIrregular: false, wantLemma: "cover"},
		{query: "limits", wantIrregular: false, wantLemma: "limit"},
		{query: "counts", wantIrregular: false, wantLemma: "count"},
		{query: "performed", wantIrregular: false, wantLemma: "perform"},
		{query: "loading", wantIrregular: false, wantLemma: "load"},
		{query: "starting", wantIrregular: false, wantLemma: "start"},
		{query: "running", wantIrregular: false, wantLemma: "run"},
		{query: "working", wantIrregular: false, wantLemma: "work"},
		{query: "goods", wantIrregular: false, wantLemma: "good"},

		// Irregular forms — MUST be irregular, MUST have correct lemma
		{query: "ran", wantIrregular: true, wantLemma: "run"},
		{query: "children", wantIrregular: true, wantLemma: "child"},

		// Lemma lookups — MUST NOT be irregular, Lemma should be nil
		{query: "define", wantIrregular: false, wantLemma: ""},
		{query: "run", wantIrregular: false, wantLemma: ""},
		{query: "start", wantIrregular: false, wantLemma: ""},
		{query: "work", wantIrregular: false, wantLemma: ""},
		{query: "good", wantIrregular: false, wantLemma: ""},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
				Msg: &dictv1.LookupWordRequest{Word: tt.query},
			})
			if err != nil {
				// Word might not be found if data sources didn't have it
				if strings.Contains(err.Error(), "not_found") {
					t.Skipf("word %q not found in pipeline data (data source gap)", tt.query)
				}
				require.NoError(t, err)
			}
			require.NotNil(t, resp.Msg)

			word := resp.Msg

			// Verify irregular flag
			assert.Equal(t, tt.wantIrregular, word.Irregular,
				"LookupWord(%q): irregular flag mismatch", tt.query)

			// Verify lemma reference
			if tt.wantLemma != "" {
				// Inflected form: must have non-nil, non-empty lemma
				require.NotNil(t, word.Lemma,
					"LookupWord(%q): Lemma must not be nil for inflected form", tt.query)
				assert.NotEmpty(t, word.GetLemma(),
					"LookupWord(%q): Lemma must not be empty", tt.query)
				assert.Equal(t, tt.wantLemma, word.GetLemma(),
					"LookupWord(%q): wrong lemma", tt.query)
			} else {
				// Lemma lookup: Lemma should be nil
				assert.Nil(t, word.Lemma,
					"LookupWord(%q): Lemma should be nil for lemma view", tt.query)
			}
		})
	}
}

// TestPipelineToAPI_InflectedFormWithoutBaseLemma tests the critical scenario:
// submitting an inflected form (e.g., "goods", "working") when the base lemma
// ("good", "work") has NOT been processed yet. The pipeline must discover the
// true base form from data sources and create the lemma correctly.
func TestPipelineToAPI_InflectedFormWithoutBaseLemma(t *testing.T) {
	ctx := context.Background()

	cfg := mustLoadPipelineQualityConfig(t)
	logger := testLogger(t)

	requirePipelineSources(t, cfg, logger)

	wikidataReader, registry := buildTestSourceRegistry(t, cfg, logger)

	// Fresh DB — no base lemmas pre-loaded
	harness := newPipelineQualityHarnessForWordbook(t, cfg, logger, nil, "inflected-only-test", registry, wikidataReader)

	// Submit inflected forms directly, WITHOUT processing base lemmas first.
	// These are real production failures from stale data.
	inflected := []string{
		"goods", "working", "records", "ones", "adjusts", "eating",
		"others", "begins", "cats", "behaviors", "writes", "motivates", "satisfying",
	}
	for _, word := range inflected {
		_, err := harness.runWord(ctx, word)
		if err != nil {
			t.Fatalf("failed to process %q: %v", word, err)
		}
	}

	snapshotRepo := repo.NewLemmaSnapshotRepository(harness.entClient)
	lemmaRepo := repo.NewLemmaRepository(harness.entClient)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := apiconnectrpc.NewDictServiceServer(wordUC)

	tests := []struct {
		query     string
		wantLemma string
	}{
		{query: "goods", wantLemma: "good"},
		{query: "working", wantLemma: "work"},
		{query: "records", wantLemma: "record"},
		{query: "ones", wantLemma: "one"},
		{query: "adjusts", wantLemma: "adjust"},
		{query: "eating", wantLemma: "eat"},
		{query: "others", wantLemma: "other"},
		{query: "begins", wantLemma: "begin"},
		{query: "cats", wantLemma: "cat"},
		{query: "behaviors", wantLemma: "behavior"},
		{query: "writes", wantLemma: "write"},
		{query: "motivates", wantLemma: "motivate"},
		{query: "satisfying", wantLemma: "satisfy"},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
				Msg: &dictv1.LookupWordRequest{Word: tt.query},
			})
			if err != nil {
				if strings.Contains(err.Error(), "not_found") {
					t.Skipf("word %q not found in pipeline data", tt.query)
				}
				require.NoError(t, err)
			}
			require.NotNil(t, resp.Msg)

			// Must have lemma pointing to the base form, not nil
			require.NotNil(t, resp.Msg.Lemma,
				"LookupWord(%q): Lemma must not be nil — system should NOT treat %q as a lemma", tt.query, tt.query)
			assert.Equal(t, tt.wantLemma, resp.Msg.GetLemma(),
				"LookupWord(%q): wrong lemma", tt.query)
		})
	}
}

// TestPipelineToAPI_StaleDataReprocessing tests the critical production scenario:
// wrong lemma data already exists in the DB, and the pipeline must fix it on reprocessing.
// Previous tests only ran on fresh databases, so they never caught:
// - shortestLemmaFormSurface picking abbreviations ("ltd") over real lemmas ("limit")
// - Old orphaned snapshots shadowing correct ones after lemma switch
func TestPipelineToAPI_StaleDataReprocessing(t *testing.T) {
	ctx := context.Background()

	cfg := mustLoadPipelineQualityConfig(t)
	logger := testLogger(t)

	requirePipelineSources(t, cfg, logger)

	wikidataReader, registry := buildTestSourceRegistry(t, cfg, logger)

	harness := newPipelineQualityHarnessForWordbook(t, cfg, logger, nil, "stale-data-test", registry, wikidataReader)

	// Step 1: Pre-populate WRONG lemma data, simulating production state.
	// Process inflected forms first (without base lemmas) so the pipeline creates
	// lemmas with potentially wrong surfaces.
	staleWords := []string{
		"limits",     // might create lemma "ltd" (abbreviation shorter than "limit")
		"records",    // might create lemma "recording"
		"ones",       // might create lemma "1" (digit shorter than "one")
		"begins",     // might create lemma "beginning"
		"writes",     // might create lemma "writing"
		"motivates",  // might create lemma "motivated"
		"satisfying", // might create lemma "satisfied"
	}
	for _, word := range staleWords {
		_, _ = harness.runWord(ctx, word) // ignore errors — some may fail
	}

	// Step 2: Now process the base lemmas (as if user/wordbook adds them later).
	baseWords := []string{"limit", "record", "one", "begin", "write", "motivate", "satisfy"}
	for _, word := range baseWords {
		_, err := harness.runWord(ctx, word)
		if err != nil {
			t.Logf("[stale] warning: failed to process base %q: %v", word, err)
		}
	}

	// Step 3: Reprocess the inflected forms — this is the real test.
	// The pipeline must correct the stale data.
	for _, word := range staleWords {
		_, err := harness.runWord(ctx, word)
		if err != nil {
			t.Logf("[stale] warning: failed to reprocess %q: %v", word, err)
		}
	}

	// Step 4: Verify API returns correct results.
	snapshotRepo := repo.NewLemmaSnapshotRepository(harness.entClient)
	lemmaRepo := repo.NewLemmaRepository(harness.entClient)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo, lemmaRepo)
	svc := apiconnectrpc.NewDictServiceServer(wordUC)

	tests := []struct {
		query     string
		wantLemma string
	}{
		{query: "limits", wantLemma: "limit"},
		{query: "records", wantLemma: "record"},
		{query: "ones", wantLemma: "one"},
		{query: "begins", wantLemma: "begin"},
		{query: "writes", wantLemma: "write"},
		{query: "motivates", wantLemma: "motivate"},
		{query: "satisfying", wantLemma: "satisfy"},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
				Msg: &dictv1.LookupWordRequest{Word: tt.query},
			})
			if err != nil {
				if strings.Contains(err.Error(), "not_found") {
					t.Skipf("word %q not found in pipeline data", tt.query)
				}
				require.NoError(t, err)
			}
			require.NotNil(t, resp.Msg)

			require.NotNil(t, resp.Msg.Lemma,
				"LookupWord(%q): Lemma must not be nil after stale data reprocessing", tt.query)
			assert.Equal(t, tt.wantLemma, resp.Msg.GetLemma(),
				"LookupWord(%q): wrong lemma after stale data reprocessing", tt.query)
		})
	}
}

// testLogger creates a logger that writes to testing.T for proper output capture.
func testLogger(t *testing.T) *slog.Logger {
	t.Helper()
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
}

// buildTestSourceRegistry creates the shared data source registry for E2E tests.
func buildTestSourceRegistry(t *testing.T, cfg *config.Config, logger *slog.Logger) (provider.WikidataProvider, *pipeline.SourceRegistry) {
	t.Helper()

	wikidataReader, err := wikidata.NewReaderWithLogger(wikidata.DataPath(cfg.Pipeline.DataDir), logger)
	require.NoError(t, err)
	t.Cleanup(func() { _ = wikidataReader.Close() })

	mobyReader, err := moby.NewReader(moby.DataPath(cfg.Pipeline.DataDir))
	require.NoError(t, err)
	t.Cleanup(func() { _ = mobyReader.Close() })

	cefrjReader, err := cefrj.NewReader(cefrj.DataDir(cfg.Pipeline.DataDir))
	require.NoError(t, err)

	registry := pipeline.NewSourceRegistry(logger)
	registry.Register(moby.NewSourceProvider(mobyReader))
	registry.Register(cefrj.NewSourceProvider(cefrjReader))

	loadTestContribSources(context.Background(), registry, logger)
	t.Cleanup(func() { registry.CloseAll() })

	return wikidataReader, registry
}
