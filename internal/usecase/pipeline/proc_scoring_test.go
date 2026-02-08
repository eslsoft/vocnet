package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScoringProcessor_NilProvider(t *testing.T) {
	p := NewScoringProcessor(nil, testLogger())
	result, err := p.Process(context.Background(), &PipelineContext{})

	assert.Nil(t, result)
	assert.True(t, IsProcessorSkipped(err))
}

func TestScoringProcessor_NoRelations(t *testing.T) {
	p := NewScoringProcessor(&mockLLM{}, testLogger())
	pctx := &PipelineContext{
		Term:      "hello",
		Relations: nil,
	}

	result, err := p.Process(context.Background(), pctx)

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusNoData, result.Status)
}

func TestScoringProcessor_ScoresRelations(t *testing.T) {
	mock := &mockLLM{
		response: `{
			"scores": [
				{
					"target_term": "greeting",
					"relation_type": "SYNONYM",
					"strength": 0.9
				},
				{
					"target_term": "goodbye",
					"relation_type": "ANTONYM",
					"strength": 0.7
				}
			]
		}`,
	}

	p := NewScoringProcessor(mock, testLogger())
	rel1 := &entity.SemanticRelation{TargetTerm: "greeting", RelationType: "SYNONYM", Strength: 0.5, Provider: "conceptnet"}
	rel2 := &entity.SemanticRelation{TargetTerm: "goodbye", RelationType: "ANTONYM", Strength: 0.5, Provider: "conceptnet"}
	pctx := &PipelineContext{
		Term:      "hello",
		Relations: []*entity.SemanticRelation{rel1, rel2},
	}

	result, err := p.Process(context.Background(), pctx)

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusExecuted, result.Status)
	// Relations are updated in-place on pctx, not returned in result
	assert.Nil(t, result.Relations)
	// Scores should be applied in-place
	assert.InDelta(t, 0.9, rel1.Strength, 0.01)
	assert.InDelta(t, 0.7, rel2.Strength, 0.01)
	assert.Len(t, result.Evidence, 1)
}

func TestScoringProcessor_LLMError(t *testing.T) {
	mock := &mockLLM{err: assert.AnError}
	p := NewScoringProcessor(mock, testLogger())
	pctx := &PipelineContext{
		Term: "test",
		Relations: []*entity.SemanticRelation{
			{TargetTerm: "exam", RelationType: "SYNONYM"},
		},
	}

	_, err := p.Process(context.Background(), pctx)
	assert.Error(t, err)
}
