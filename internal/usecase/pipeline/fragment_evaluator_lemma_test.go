package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFragmentEvaluator_EvaluatesLemmaUpdate(t *testing.T) {
	scorer := NewRuleBasedScorer()
	evaluator := NewFragmentEvaluator(scorer, testLogger())

	// Create pipeline context with ProcessResults containing LemmaUpdate
	pctx := &PipelineContext{
		ProcessResults: []*ProcessResult{
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
	assert.Equal(t, ProcessStatusExecuted, result.Status)

	// Check that evaluated fragments were created
	require.NotNil(t, pctx.EvaluatedFragments)

	// Should have metadata fragments from both providers
	levelFragments, ok := pctx.EvaluatedFragments["metadata.level"]
	require.True(t, ok, "Should have level fragments")
	assert.Len(t, levelFragments, 2, "Should have fragments from both providers")

	// Find CEFRJ fragment
	var cefrjFragment *FieldFragment
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
	scorer := NewRuleBasedScorer()
	evaluator := NewFragmentEvaluator(scorer, testLogger())

	pctx := &PipelineContext{
		ProcessResults: []*ProcessResult{
			{
				Provider:    "cefrj",
				LemmaUpdate: &entity.Lemma{}, // Empty lemma update
			},
		},
	}

	result, err := evaluator.Process(context.Background(), pctx)
	require.NoError(t, err)
	assert.Equal(t, ProcessStatusExecuted, result.Status)

	// Should not create any metadata fragments for empty updates
	require.NotNil(t, pctx.EvaluatedFragments)
	assert.Empty(t, pctx.EvaluatedFragments, "Should have no fragments for empty lemma update")
}
