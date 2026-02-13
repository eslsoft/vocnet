package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

type mockConceptNetProvider struct {
	edges []provider.ConceptNetEdge
}

func (m *mockConceptNetProvider) FetchRelations(_ context.Context, _ string, _ string) ([]provider.ConceptNetEdge, map[string]any, error) {
	return m.edges, map[string]any{}, nil
}

func TestConceptNetProcessor_TargetRefLanguage(t *testing.T) {
	// All edges are same-language (en). TargetRef must use the edge's actual language.
	p := NewConceptNetProcessor(&mockConceptNetProvider{
		edges: []provider.ConceptNetEdge{
			{
				RelationType:  entity.RelationSynonym,
				StartTerm:     "run",
				StartLanguage: "en",
				EndTerm:       "jog",
				EndLanguage:   "en",
				Weight:        3.0,
			},
		},
	})

	pctx := &PipelineContext{
		Term:     "run",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1"}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.Len(t, res.Relations, 1)

	r := res.Relations[0]
	require.Equal(t, "jog", r.TargetTerm)
	// TargetRef must carry the correct language from the edge, not a hardcoded fallback.
	require.Equal(t, "conceptnet://c/en/jog", r.TargetRef)
}

func TestConceptNetProcessor_TargetTermIsPlainWord(t *testing.T) {
	// Verify that TargetTerm contains only the plain word/phrase, not a URI or language tag.
	p := NewConceptNetProcessor(&mockConceptNetProvider{
		edges: []provider.ConceptNetEdge{
			{
				RelationType:  entity.RelationAntonym,
				StartTerm:     "hot",
				StartLanguage: "en",
				EndTerm:       "cold",
				EndLanguage:   "en",
				Weight:        5.0,
			},
		},
	})

	pctx := &PipelineContext{
		Term:     "hot",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1"}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.Len(t, res.Relations, 1)

	r := res.Relations[0]
	// TargetTerm must be a plain word, no slashes, no language prefixes.
	require.Equal(t, "cold", r.TargetTerm)
	require.NotContains(t, r.TargetTerm, "/")
}

func TestConceptNetProcessor_LowWeightEdgesFiltered(t *testing.T) {
	// Edges with weight <= 1.0 must be pruned regardless of language.
	p := NewConceptNetProcessor(&mockConceptNetProvider{
		edges: []provider.ConceptNetEdge{
			{
				RelationType:  entity.RelationAssociation,
				StartTerm:     "dog",
				StartLanguage: "en",
				EndTerm:       "cat",
				EndLanguage:   "en",
				Weight:        1.0, // exactly at the threshold, should be pruned
			},
			{
				RelationType:  entity.RelationAssociation,
				StartTerm:     "dog",
				StartLanguage: "en",
				EndTerm:       "pet",
				EndLanguage:   "en",
				Weight:        2.0, // above threshold, should survive
			},
		},
	})

	pctx := &PipelineContext{
		Term:     "dog",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1"}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.Len(t, res.Relations, 1)
	require.Equal(t, "pet", res.Relations[0].TargetTerm)
}
