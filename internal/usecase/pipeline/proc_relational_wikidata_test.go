package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

type mockWikidataRelationProvider struct {
	byForm map[string][]provider.WikidataLexeme
}

func (m *mockWikidataRelationProvider) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	return nil, nil, nil
}

func (m *mockWikidataRelationProvider) FetchLexemesByForm(ctx context.Context, form string, language string) ([]provider.WikidataLexeme, error) {
	return m.byForm[form], nil
}

func TestWikidataRelationProcessor_Process(t *testing.T) {
	p := NewWikidataRelationProcessor(&mockWikidataRelationProvider{
		byForm: map[string][]provider.WikidataLexeme{
			"bank": {
				{LexemeID: "L1", Language: "en"},
				{LexemeID: "L2", Language: "en"},
			},
		},
	})

	pctx := &PipelineContext{
		Term:     "bank",
		Language: entity.LanguageEnglish,
		Lexemes: []*entity.Lexeme{
			{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeechNoun},
			{ExternalID: "L2", PartOfSpeech: entity.PartOfSpeechVerb},
		},
		Forms: []*entity.LemmaForm{
			{Surface: "bank", FormType: entity.FormTypeLemma},
		},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, res)
	require.Equal(t, ProcessStatusExecuted, res.Status)
	require.NotEmpty(t, res.Relations)
	require.Equal(t, "wikidata://lexeme/L2", res.Relations[0].TargetRef)
}
