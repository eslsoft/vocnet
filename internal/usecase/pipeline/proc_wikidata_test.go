package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockWikidataProvider struct {
	searchEntityFn func(ctx context.Context, term string, language string) (*provider.WikidataEntity, error)
	fetchLexemesFn func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error)
}

func (m *mockWikidataProvider) SearchEntity(ctx context.Context, term string, language string) (*provider.WikidataEntity, error) {
	return m.searchEntityFn(ctx, term, language)
}

func (m *mockWikidataProvider) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	return m.fetchLexemesFn(ctx, term, language)
}

func TestWikidataProcessor_Process_AllowsMissingEntitySearchWhenLexemesExist(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		searchEntityFn: func(ctx context.Context, term string, language string) (*provider.WikidataEntity, error) {
			return nil, nil
		},
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

	pctx := &PipelineContext{
		Term:     "mission",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "mission"},
	}

	result, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, ProcessStatusExecuted, result.Status)
	assert.Len(t, result.Lexemes, 1)
	assert.Len(t, result.Forms, 1)
	assert.Nil(t, result.LemmaUpdate)
}

func TestWikidataProcessor_Process_RejectsWhenNoLexemeAndNoEntity(t *testing.T) {
	p := NewWikidataProcessor(&mockWikidataProvider{
		searchEntityFn: func(ctx context.Context, term string, language string) (*provider.WikidataEntity, error) {
			return nil, nil
		},
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return nil, map[string]any{"source": "test"}, nil
		},
	}, testLogger())

	pctx := &PipelineContext{
		Term:     "mission",
		Language: entity.LanguageEnglish,
		Lemma:    &entity.Lemma{ID: 1, Surface: "mission"},
	}

	result, err := p.Process(context.Background(), pctx)
	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "word not found in Wikidata")
}
