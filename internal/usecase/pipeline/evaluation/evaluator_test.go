package evaluation

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/engine"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFragmentEvaluator_EvaluatesLemmaUpdate(t *testing.T) {
	scorer := scoring.NewRuleBasedScorer()
	evaluator := NewFragmentEvaluator(scorer, testLogger())

	// Create pipeline context with ProcessResults containing LemmaUpdate
	pctx := &engine.PipelineContext{
		ProcessResults: []*scoring.ProcessResult{
			{
				Provider: "cefrj",
				LemmaUpdate: &entity.Lemma{
					Level: "A1",
					Frequencies: []entity.Frequency{
						{Corpus: "brown", Count: 1234},
					},
					Syllables: []string{"hel", "lo"},
				},
			},
			{
				Provider: "ecdict",
				LemmaUpdate: &entity.Lemma{
					Level: "B1", // Different level for comparison
				},
			},
		},
	}

	result, err := evaluator.Process(context.Background(), pctx)
	require.NoError(t, err)
	assert.Equal(t, scoring.ProcessStatusExecuted, result.Status)

	// Check that evaluated fragments were created
	require.NotNil(t, pctx.EvaluatedFragments)

	// Should have metadata fragments from both providers
	levelFragments, ok := pctx.EvaluatedFragments["metadata.level"]
	require.True(t, ok, "Should have level fragments")
	assert.Len(t, levelFragments, 2, "Should have fragments from both providers")

	// Find CEFRJ fragment
	var cefrjFragment *scoring.FieldFragment
	for _, f := range levelFragments {
		if f.Provider == "cefrj" {
			cefrjFragment = f
			break
		}
	}
	require.NotNil(t, cefrjFragment, "Should have CEFRJ level fragment")
	assert.Equal(t, "metadata.level", cefrjFragment.Type)
	assert.Equal(t, "A1", cefrjFragment.Data)
	assert.Equal(t, "cefrj", cefrjFragment.Provider)
	assert.Greater(t, cefrjFragment.Score.Score, 0.0, "Should have positive score")

	// Should have frequency and syllable fragments from CEFRJ
	freqFragments, ok := pctx.EvaluatedFragments["metadata.frequencies"]
	require.True(t, ok, "Should have frequency fragments")
	assert.Len(t, freqFragments, 1)
	assert.Equal(t, "cefrj", freqFragments[0].Provider)

	sylFragments, ok := pctx.EvaluatedFragments["metadata.syllables"]
	require.True(t, ok, "Should have syllable fragments")
	assert.Len(t, sylFragments, 1)
	assert.Equal(t, "cefrj", sylFragments[0].Provider)
}

func TestFragmentEvaluator_IgnoresEmptyLemmaUpdate(t *testing.T) {
	scorer := scoring.NewRuleBasedScorer()
	evaluator := NewFragmentEvaluator(scorer, testLogger())

	pctx := &engine.PipelineContext{
		ProcessResults: []*scoring.ProcessResult{
			{
				Provider:    "cefrj",
				LemmaUpdate: &entity.Lemma{}, // Empty lemma update
			},
		},
	}

	result, err := evaluator.Process(context.Background(), pctx)
	require.NoError(t, err)
	assert.Equal(t, scoring.ProcessStatusExecuted, result.Status)

	// Should not create any metadata fragments for empty updates
	require.NotNil(t, pctx.EvaluatedFragments)
	assert.Empty(t, pctx.EvaluatedFragments, "Should have no fragments for empty lemma update")
}

func TestFragmentEvaluator_NoBlindEvaluation(t *testing.T) {
	scorer := scoring.NewRuleBasedScorer()
	fe := NewFragmentEvaluator(scorer, testLogger())

	pctx := &engine.PipelineContext{
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
