package collection

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockWikidataProvider struct {
	fetchLexemesFn       func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error)
	fetchLexemesByFormFn func(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error)
}

func (m *mockWikidataProvider) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	return m.fetchLexemesFn(ctx, term, language)
}

func (m *mockWikidataProvider) FetchLexemesByForm(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error) {
	if m.fetchLexemesByFormFn != nil {
		return m.fetchLexemesByFormFn(ctx, form, language)
	}
	return nil, nil
}

func TestWikidataProcessor_Process_ExecutesWhenLexemesExist(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return []provider.WikidataLexeme{
				{
					LexemeID: "L123",
					Language: "en",
					POS:      "verb",
					Senses: []provider.WikidataSense{
						{
							SenseID: "S1",
							Glosses: map[string]string{"en": "to send on assignment"},
						},
					},
					Forms: []provider.WikidataForm{
						{
							FormID:         "F1",
							Representation: "missions",
							Features:       []string{"Q146786"},
						},
					},
				},
			}, map[string]any{"source": "test"}, nil
		},
	}, testLogger())

	pctx := &pipeline.PipelineContext{
		Term:     "mission",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "mission"},
	}

	result, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, scoring.ProcessStatusExecuted, result.Status)
	assert.Len(t, result.Lexemes, 1)
	assert.Len(t, result.Forms, 2)
	assert.Equal(t, "mission", result.Forms[1].Surface)
	assert.Nil(t, result.LemmaUpdate)
}

func TestWikidataProcessor_Process_RejectsWhenNoLexeme(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return nil, map[string]any{"source": "test"}, nil
		},
	}, testLogger())

	pctx := &pipeline.PipelineContext{
		Term:     "mission",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "mission"},
	}

	result, err := p.Process(context.Background(), pctx)
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "word not found in Wikidata")
}

func TestWikidataProcessor_Process_RejectsLowConfidenceAmbiguousMatch(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return []provider.WikidataLexeme{
					{LexemeID: "L1", Language: "en", POS: "noun"},
					{LexemeID: "L2", Language: "en", POS: "verb"},
				}, map[string]any{
					"match_score":     40,
					"candidate_count": 2,
				}, nil
		},
	}, testLogger())

	pctx := &pipeline.PipelineContext{
		Term:     "edgecase",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "edgecase"},
	}

	result, err := p.Process(context.Background(), pctx)
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "low-confidence lexeme match rejected")
}

func TestWikidataProcessor_Process_FailsOnUnknownWikidataPOSQID(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return []provider.WikidataLexeme{
				{
					LexemeID: "L1",
					Language: "en",
					POS:      "Q999999999",
				},
			}, map[string]any{"source": "test"}, nil
		},
	}, testLogger())

	pctx := &pipeline.PipelineContext{
		Term:     "edgecase",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "edgecase"},
	}

	result, err := p.Process(context.Background(), pctx)
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pos mapping failed")
}

func TestWikidataProcessor_Process_BuildsRelations(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return []provider.WikidataLexeme{
				{LexemeID: "L1", Language: "en", POS: "noun"},
				{LexemeID: "L2", Language: "en", POS: "verb"},
			}, map[string]any{"source": "test"}, nil
		},
		fetchLexemesByFormFn: func(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error) {
			return []provider.WikidataLexeme{
				{LexemeID: "L1", Language: "en"},
				{LexemeID: "L2", Language: "en"},
			}, nil
		},
	}, testLogger())

	pctx := &pipeline.PipelineContext{
		Term:     "bank",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "bank"},
		Forms: []*entity.LemmaForm{
			{Surface: "bank", FormType: entity.FormTypeLemma},
		},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, res)
	require.Equal(t, scoring.ProcessStatusExecuted, res.Status)
	// Should have relation linking L1 to L2 (sibling lexemes)
	require.NotEmpty(t, res.Relations)
	require.Equal(t, "wikidata://lexeme/L2", res.Relations[0].TargetRef)
}
