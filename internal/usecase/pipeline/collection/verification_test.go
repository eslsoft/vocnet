package collection

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type localMockWikidataProvider struct {
	fetchLexemesFn func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error)
}

func (m *localMockWikidataProvider) FetchLexemes(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
	return m.fetchLexemesFn(ctx, term, language)
}

func TestWikidataProcessor_SetsProvider(t *testing.T) {
	// Mock response from Wikidata reader
	mockResp := map[string]any{
		"lexemes": []map[string]any{
			{
				"id":  "L1",
				"pos": "Q1084", // noun
				"senses": []map[string]any{
					{"glosses": map[string]string{"en": "a domestic animal"}},
				},
				"forms": []map[string]any{
					{
						"rep":       "dog",
						"phonetics": []map[string]any{{"ipa": "/dɒɡ/"}},
					},
				},
			},
		},
	}

	// Reconstruct what the reader would return
	providerLexemes := []provider.WikidataLexeme{
		{
			LexemeID: "L1",
			Lemma:    "dog",
			POS:      "Q1084",
			Language: "en",
			Senses: []provider.WikidataSense{
				{Glosses: map[string]string{"en": "a domestic animal"}},
			},
			Forms: []provider.WikidataForm{
				{
					Representation: "dog",
					Phonetics:      []provider.WikidataPhonetic{{IPA: "/dɒɡ/"}},
				},
			},
		},
	}

	mockWiki := &localMockWikidataProvider{
		fetchLexemesFn: func(ctx context.Context, term string, language string) ([]provider.WikidataLexeme, map[string]any, error) {
			return providerLexemes, mockResp, nil
		},
	}

	proc := NewWikidataProcessor(mockWiki, testLogger())
	pctx := &pipeline.PipelineContext{Term: "dog", Language: entity.LanguageEnglish}

	result, err := proc.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Verify LexemeSense Provider
	require.NotEmpty(t, result.Lexemes)
	assert.Equal(t, "wikidata", result.Lexemes[0].Senses[0].Provider)

	// Verify Phonetic Provider
	require.NotEmpty(t, result.Forms)
	assert.Equal(t, "wikidata", result.Forms[0].Phonetics[0].Provider)
}

type mockLLMProvider struct {
	completeFn func(ctx context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error)
}

func (m *mockLLMProvider) Complete(ctx context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error) {
	return m.completeFn(ctx, req)
}

func TestLLMEnrichmentProcessor_CorrectMapping(t *testing.T) {
	// Setup: context with 2 relations, but only the 2nd one needs mapping (index 1)
	pctx := &pipeline.PipelineContext{
		Term: "run",
		Lexemes: []*entity.Lexeme{
			{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeechNoun, SenseGloss: "movement"},
		},
		Relations: []*entity.SemanticRelation{
			{RelationType: "synonym", TargetTerm: "walk", SenseMapped: true, SourceExternalID: "L1", Provider: "wikidata"},
			{RelationType: "synonym", TargetTerm: "sprint", SenseMapped: false, Provider: "conceptnet"},
		},
	}

	mockLLM := &mockLLMProvider{
		completeFn: func(ctx context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error) {
			// Simulate LLM response mapping relation with ID "1" (the second one)
			resp := llmEnrichmentResponse{
				MappedRelations: []mappedRelation{
					{RelationID: "1", SourceLexemeID: "L1"},
				},
				ScoredRelations: []scoredRelation{
					{RelationID: "1", Strength: 0.9},
				},
			}
			data, _ := json.Marshal(resp)
			return &llm.CompletionResponse{Content: string(data)}, nil
		},
	}

	proc := NewLLMEnrichmentProcessor(mockLLM, testLogger())

	result, err := proc.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, result)

	// Verify the second relation (index 1) was updated, NOT the first one
	assert.Equal(t, "L1", pctx.Relations[1].SourceExternalID)
	assert.True(t, pctx.Relations[1].SenseMapped)
	assert.Equal(t, 0.9, pctx.Relations[1].Strength)
	assert.Equal(t, "llm", pctx.Relations[1].Provider) // ConceptNet upgraded to LLM

	// Verify the first relation (index 0) was UNTOUCHED
	assert.Equal(t, "wikidata", pctx.Relations[0].Provider)
	assert.Equal(t, "walk", pctx.Relations[0].TargetTerm)
}
