package pipeline

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/entity"
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
	pctx := &PipelineContext{Term: "dog", Language: entity.LanguageEnglish}

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

func TestFragmentEvaluator_NoBlindEvaluation(t *testing.T) {
	scorer := NewRuleBasedScorer()
	fe := NewFragmentEvaluator(scorer, testLogger())

	pctx := &PipelineContext{
		Term: "run",
		Evidence: []*entity.RawEvidence{
			{Provider: "wikidata"},
			{Provider: "ecdict"},
		},
		Lexemes: []*entity.Lexeme{
			{
				PartOfSpeech: entity.PartOfSpeechNoun,
				Language:     entity.LanguageEnglish,
				Senses: []entity.LexemeSense{
					{Gloss: "sense from wikidata", Provider: "wikidata"},
				},
			},
			{
				PartOfSpeech: entity.PartOfSpeechVerb,
				Language:     entity.LanguageEnglish,
				Senses: []entity.LexemeSense{
					{Gloss: "sense from ecdict", Provider: "ecdict"},
				},
			},
		},
		Relations: []*entity.SemanticRelation{
			{RelationType: "synonym", TargetTerm: "sprint", Provider: "wikidata"},
		},
	}

	// Run for "wikidata"
	res, err := fe.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, res)

	// In pctx.EvaluatedFragments, check wikidata's view
	// It should NOT contain the verb lexeme because it belongs to ecdict
	wikiLexemes := 0
	ecdictLexemes := 0

	for key, frags := range pctx.EvaluatedFragments {
		for _, f := range frags {
			if f.Type == "lexeme" {
				switch f.Provider {
				case "wikidata":
					wikiLexemes++
					assert.Contains(t, key, "noun")
				case "ecdict":
					ecdictLexemes++
					assert.Contains(t, key, "verb")
				}
			}
		}
	}

	assert.Equal(t, 1, wikiLexemes)
	assert.Equal(t, 1, ecdictLexemes)

	// Verification of relation attribution
	relationFound := false
	for _, frags := range pctx.EvaluatedFragments {
		for _, f := range frags {
			if f.Type == "relation" && f.Provider == "wikidata" {
				relationFound = true
			}
		}
	}
	assert.True(t, relationFound)
}

type mockLLMProvider struct {
	completeFn func(ctx context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error)
}

func (m *mockLLMProvider) Complete(ctx context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error) {
	return m.completeFn(ctx, req)
}

func TestLLMEnrichmentProcessor_CorrectMapping(t *testing.T) {
	// Setup: context with 2 relations, but only the 2nd one needs mapping (index 1)
	pctx := &PipelineContext{
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
