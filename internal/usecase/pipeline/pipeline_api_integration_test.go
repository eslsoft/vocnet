//go:build integration

package pipeline_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	apiconnectrpc "github.com/eslsoft/vocnet/internal/adapter/connectrpc"
	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	repo "github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/usecase"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// lemmaTestEntry represents a single lemma and its expected forms from testdata.
type lemmaTestEntry struct {
	Lemma string         `json:"lemma"`
	Forms []formTestCase `json:"forms"`
}

type formTestCase struct {
	Surface   string `json:"surface"`
	Irregular bool   `json:"irregular"`
	AlsoLemma bool   `json:"also_lemma"` // form is also an independent lemma in Wikidata (e.g., "drunk", "better")
}

func loadLemmaTestData(t *testing.T) []lemmaTestEntry {
	t.Helper()

	path := filepath.Join("testdata", "lemma_forms.json")
	data, err := os.ReadFile(path)
	require.NoError(t, err, "failed to read testdata/lemma_forms.json")

	var entries []lemmaTestEntry
	require.NoError(t, json.Unmarshal(data, &entries))
	require.NotEmpty(t, entries, "testdata is empty")
	return entries
}

// buildIntegrationHarness creates a shared harness for integration tests.
func buildIntegrationHarness(
	t *testing.T,
	name string,
) (*qualityHarness, *wikidata.Reader, *pipeline.SourceRegistry) {
	t.Helper()

	cfg := mustLoadPipelineQualityConfig(t)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))

	requirePipelineSources(t, cfg, logger)

	wikidataReader, registry := buildSourceRegistry(t, cfg, logger)
	harness := newPipelineQualityHarnessForWordbook(t, cfg, logger, nil, name, registry, wikidataReader)

	return harness, wikidataReader, registry
}

func buildSourceRegistry(t *testing.T, cfg *config.Config, logger *slog.Logger) (*wikidata.Reader, *pipeline.SourceRegistry) {
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

func buildDictService(t *testing.T, harness *qualityHarness) *apiconnectrpc.DictServiceServer {
	t.Helper()
	snapshotRepo := repo.NewLemmaSnapshotRepository(harness.entClient)
	wordUC := usecase.NewSnapshotWordUsecase(snapshotRepo)
	return apiconnectrpc.NewDictServiceServer(wordUC)
}

// TestPipelineToAPI_DataCorrectness is the core correctness test.
// It processes all base lemmas from testdata, then verifies every form's
// lemma resolution and irregular flag.
func TestPipelineToAPI_DataCorrectness(t *testing.T) {
	ctx := context.Background()
	entries := loadLemmaTestData(t)
	harness, _, _ := buildIntegrationHarness(t, "data-correctness")

	// Step 1: Process all base lemmas.
	for _, entry := range entries {
		_, err := harness.runWord(ctx, entry.Lemma)
		if err != nil {
			t.Logf("warning: failed to process base lemma %q: %v", entry.Lemma, err)
		}
	}

	// Step 2: Process all inflected forms (so suppletive forms like went/ate get snapshots).
	for _, entry := range entries {
		for _, form := range entry.Forms {
			_, err := harness.runWord(ctx, form.Surface)
			if err != nil {
				t.Logf("warning: failed to process form %q: %v", form.Surface, err)
			}
		}
	}

	svc := buildDictService(t, harness)

	// Step 3: Verify base lemma lookups — Lemma should be nil, Irregular should be false.
	t.Run("base_lemmas", func(t *testing.T) {
		for _, entry := range entries {
			t.Run(entry.Lemma, func(t *testing.T) {
				resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
					Msg: &dictv1.LookupWordRequest{Word: entry.Lemma},
				})
				if err != nil {
					if strings.Contains(err.Error(), "not_found") {
						t.Skipf("word %q not found (data source gap)", entry.Lemma)
					}
					require.NoError(t, err)
				}
				require.NotNil(t, resp.Msg)
				assert.Nil(t, resp.Msg.Lemma,
					"LookupWord(%q): base lemma should have Lemma=nil", entry.Lemma)
				assert.False(t, resp.Msg.Irregular,
					"LookupWord(%q): base lemma should have Irregular=false", entry.Lemma)
			})
		}
	})

	// Step 4: Verify inflected form lookups — correct lemma + correct irregular flag.
	t.Run("inflected_forms", func(t *testing.T) {
		for _, entry := range entries {
			for _, form := range entry.Forms {
				// Skip zero-plural where surface == lemma (e.g., sheep→sheep).
				if strings.EqualFold(form.Surface, entry.Lemma) {
					continue
				}
				t.Run(form.Surface, func(t *testing.T) {
					resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
						Msg: &dictv1.LookupWordRequest{Word: form.Surface},
					})
					if err != nil {
						if strings.Contains(err.Error(), "not_found") {
							t.Skipf("word %q not found (data source gap)", form.Surface)
						}
						require.NoError(t, err)
					}
					require.NotNil(t, resp.Msg)

					if form.AlsoLemma {
						// Irregular forms that are also independent Wikidata lemmas (e.g., "drunk", "better")
						// may resolve as their own lemma — both outcomes are acceptable.
						if resp.Msg.Lemma != nil {
							assert.Equal(t, entry.Lemma, resp.Msg.GetLemma(),
								"LookupWord(%q): wrong lemma", form.Surface)
						}
						return
					}

					require.NotNil(t, resp.Msg.Lemma,
						"LookupWord(%q): inflected form must have Lemma != nil", form.Surface)
					assert.Equal(t, entry.Lemma, resp.Msg.GetLemma(),
						"LookupWord(%q): wrong lemma", form.Surface)
					assert.Equal(t, form.Irregular, resp.Msg.Irregular,
						"LookupWord(%q): irregular flag mismatch (want %v)", form.Surface, form.Irregular)
				})
			}
		}
	})
}

// TestPipelineToAPI_InflectedFirstOrdering tests pipeline resilience when
// inflected forms are submitted BEFORE their base lemmas exist.
// The pipeline must discover the base form from data sources automatically.
func TestPipelineToAPI_InflectedFirstOrdering(t *testing.T) {
	ctx := context.Background()
	entries := loadLemmaTestData(t)
	harness, _, _ := buildIntegrationHarness(t, "inflected-first")

	// Only submit inflected forms — NO base lemmas pre-loaded.
	// Filter to non-suppletive forms (those with a prefix relationship to their lemma),
	// because suppletive forms (went→go) fundamentally require the base lemma to exist.
	var inflected []struct {
		surface   string
		lemma     string
		alsoLemma bool
	}
	for _, entry := range entries {
		for _, form := range entry.Forms {
			if strings.EqualFold(form.Surface, entry.Lemma) {
				continue
			}
			// Only include forms where lemma is a prefix of the surface,
			// or the surface ends with a known regular suffix derived from the lemma.
			if hasRegularRelationship(entry.Lemma, form.Surface) {
				inflected = append(inflected, struct {
					surface   string
					lemma     string
					alsoLemma bool
				}{surface: form.Surface, lemma: entry.Lemma, alsoLemma: form.AlsoLemma})
			}
		}
	}

	for _, item := range inflected {
		_, err := harness.runWord(ctx, item.surface)
		if err != nil {
			t.Logf("warning: failed to process %q: %v", item.surface, err)
		}
	}

	svc := buildDictService(t, harness)

	for _, item := range inflected {
		t.Run(item.surface, func(t *testing.T) {
			resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
				Msg: &dictv1.LookupWordRequest{Word: item.surface},
			})
			if err != nil {
				if strings.Contains(err.Error(), "not_found") {
					t.Skipf("word %q not found", item.surface)
				}
				require.NoError(t, err)
			}
			require.NotNil(t, resp.Msg)

			if item.alsoLemma {
				if resp.Msg.Lemma != nil {
					assert.Equal(t, item.lemma, resp.Msg.GetLemma(),
						"LookupWord(%q): wrong lemma", item.surface)
				}
				return
			}

			require.NotNil(t, resp.Msg.Lemma,
				"LookupWord(%q): Lemma must not be nil — system should discover base form", item.surface)
			assert.Equal(t, item.lemma, resp.Msg.GetLemma(),
				"LookupWord(%q): wrong lemma", item.surface)
		})
	}
}

// TestPipelineToAPI_Idempotency verifies that processing words multiple times
// and in different orders produces identical results.
func TestPipelineToAPI_Idempotency(t *testing.T) {
	ctx := context.Background()
	entries := loadLemmaTestData(t)
	harness, _, _ := buildIntegrationHarness(t, "idempotency")

	// Pick a subset for idempotency testing (no need to run the full set).
	subset := pickIdempotencySubset(entries)

	// Round 1: inflected forms only.
	for _, item := range subset {
		for _, form := range item.Forms {
			_, _ = harness.runWord(ctx, form.Surface)
		}
	}

	// Round 2: base lemmas.
	for _, item := range subset {
		_, _ = harness.runWord(ctx, item.Lemma)
	}

	// Round 3: inflected forms again.
	for _, item := range subset {
		for _, form := range item.Forms {
			_, _ = harness.runWord(ctx, form.Surface)
		}
	}

	svc := buildDictService(t, harness)

	for _, entry := range subset {
		for _, form := range entry.Forms {
			if strings.EqualFold(form.Surface, entry.Lemma) {
				continue
			}
			t.Run(form.Surface, func(t *testing.T) {
				resp, err := svc.LookupWord(ctx, &connect.Request[dictv1.LookupWordRequest]{
					Msg: &dictv1.LookupWordRequest{Word: form.Surface},
				})
				if err != nil {
					if strings.Contains(err.Error(), "not_found") {
						t.Skipf("word %q not found", form.Surface)
					}
					require.NoError(t, err)
				}
				require.NotNil(t, resp.Msg)

				if form.AlsoLemma {
					if resp.Msg.Lemma != nil {
						assert.Equal(t, entry.Lemma, resp.Msg.GetLemma(),
							"LookupWord(%q): wrong lemma after 3 rounds", form.Surface)
					}
					return
				}

				require.NotNil(t, resp.Msg.Lemma,
					"LookupWord(%q): Lemma must not be nil after 3 rounds", form.Surface)
				assert.Equal(t, entry.Lemma, resp.Msg.GetLemma(),
					"LookupWord(%q): wrong lemma after 3 rounds", form.Surface)
			})
		}
	}
}

func pickIdempotencySubset(entries []lemmaTestEntry) []lemmaTestEntry {
	want := map[string]bool{
		"limit": true, "record": true, "write": true,
		"satisfy": true, "run": true, "go": true, "good": true,
	}
	var out []lemmaTestEntry
	for _, e := range entries {
		if want[e.Lemma] {
			out = append(out, e)
		}
	}
	return out
}

// hasRegularRelationship checks whether the form has a morphological prefix
// relationship to the lemma (i.e., the pipeline can discover the base form
// without prior knowledge).
func hasRegularRelationship(lemma, form string) bool {
	l := strings.ToLower(lemma)
	f := strings.ToLower(form)

	if strings.HasPrefix(f, l) {
		return true
	}

	// Handle consonant+y→ies, consonant+y→ied, etc. (e.g., satisfy→satisfies)
	if len(l) > 1 && l[len(l)-1] == 'y' {
		stem := l[:len(l)-1]
		if strings.HasPrefix(f, stem) {
			return true
		}
	}

	// Handle e-dropping (e.g., define→defining, nice→nicer)
	if len(l) > 1 && l[len(l)-1] == 'e' {
		stem := l[:len(l)-1]
		if strings.HasPrefix(f, stem) {
			return true
		}
	}

	// Handle CVC doubling (e.g., hot→hotter, big→bigger)
	if len(l) >= 2 && len(f) >= len(l)+1 && f[:len(l)] == l && f[len(l)] == l[len(l)-1] {
		return true
	}

	return false
}
