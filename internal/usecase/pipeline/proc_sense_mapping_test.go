package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider/llm"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSenseMappingProcessor_NilProvider(t *testing.T) {
	p := NewSenseMappingProcessor(nil, testLogger())
	result, err := p.Process(context.Background(), &PipelineContext{})

	assert.Nil(t, result)
	assert.True(t, IsProcessorSkipped(err))
}

func TestSenseMappingProcessor_NoUnmappedRelations(t *testing.T) {
	p := NewSenseMappingProcessor(&mockLLM{}, testLogger())
	pctx := &PipelineContext{
		Term: "hello",
		Lexemes: []*entity.Lexeme{
			{ID: 1, ExternalID: "L100", PartOfSpeech: entity.PartOfSpeechNoun},
		},
		Relations: []*entity.SemanticRelation{
			{TargetTerm: "world", RelationType: "SYNONYM", SenseMapped: true},
		},
	}

	result, err := p.Process(context.Background(), pctx)

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusNoData, result.Status)
}

func TestSenseMappingProcessor_MapsRelations(t *testing.T) {
	mock := &mockLLM{
		response: `{
			"mappings": [
				{
					"target_term": "greeting",
					"relation_type": "SYNONYM",
					"lexeme_id": "L100"
				},
				{
					"target_term": "salutation",
					"relation_type": "SYNONYM",
					"lexeme_id": ""
				}
			]
		}`,
	}

	p := NewSenseMappingProcessor(mock, testLogger())
	rel1 := &entity.SemanticRelation{TargetTerm: "greeting", RelationType: "SYNONYM", SenseMapped: false, Strength: 0.5}
	rel2 := &entity.SemanticRelation{TargetTerm: "salutation", RelationType: "SYNONYM", SenseMapped: false, Strength: 0.3}
	pctx := &PipelineContext{
		Term: "hello",
		Lexemes: []*entity.Lexeme{
			{ID: 42, ExternalID: "L100", PartOfSpeech: entity.PartOfSpeechNoun, SenseGloss: "a greeting"},
		},
		Relations: []*entity.SemanticRelation{rel1, rel2},
	}

	result, err := p.Process(context.Background(), pctx)

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusExecuted, result.Status)
	// Relations are updated in-place on pctx, not returned in result
	assert.Nil(t, result.Relations)
	// "greeting" should be mapped in-place
	assert.True(t, rel1.SenseMapped)
	assert.Equal(t, "L100", rel1.SourceExternalID)
	// "salutation" has empty lexeme_id, should remain unmapped
	assert.False(t, rel2.SenseMapped)
	assert.Len(t, result.Evidence, 1)
	assert.Equal(t, "llm", result.Evidence[0].Provider)
}

func TestSenseMappingProcessor_LLMError(t *testing.T) {
	mock := &mockLLM{err: assert.AnError}
	p := NewSenseMappingProcessor(mock, testLogger())
	pctx := &PipelineContext{
		Term:    "test",
		Lexemes: []*entity.Lexeme{{ID: 1, ExternalID: "L1"}},
		Relations: []*entity.SemanticRelation{
			{TargetTerm: "exam", RelationType: "SYNONYM", SenseMapped: false},
		},
	}

	_, err := p.Process(context.Background(), pctx)
	assert.Error(t, err)
}

// mockLLM is a test double for llm.Provider.
type mockLLM struct {
	response string
	err      error
	lastReq  *llm.CompletionRequest
}

func (m *mockLLM) Complete(_ context.Context, req *llm.CompletionRequest) (*llm.CompletionResponse, error) {
	m.lastReq = req
	if m.err != nil {
		return nil, m.err
	}
	return &llm.CompletionResponse{
		Content:    m.response,
		TokenCount: 100,
		Cached:     false,
	}, nil
}
