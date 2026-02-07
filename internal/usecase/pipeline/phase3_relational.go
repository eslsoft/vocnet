package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Phase3Relational implements the relational phase (builds semantic relation graph).
type Phase3Relational struct {
	conceptnet   provider.ConceptNetProvider
	lexemeRepo   repository.LexemeRepository
}

func NewPhase3Relational(conceptnet provider.ConceptNetProvider, lexemeRepo repository.LexemeRepository) *Phase3Relational {
	return &Phase3Relational{
		conceptnet: conceptnet,
		lexemeRepo: lexemeRepo,
	}
}

func (p *Phase3Relational) Name() string {
	return entity.PhaseRelational.Name()
}

func (p *Phase3Relational) Number() int {
	return int(entity.PhaseRelational)
}

func (p *Phase3Relational) Execute(ctx context.Context, lemma *entity.Lemma) (*PhaseResult, error) {
	lang := entity.ParseLanguage("en") // TODO: get from lemma context

	// Fetch relations from ConceptNet
	edges, rawResp, err := p.conceptnet.FetchRelations(ctx, lemma.Surface, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("conceptnet fetch: %w", err)
	}

	// Create evidence
	evidence := &entity.RawEvidence{
		Provider:      "conceptnet",
		Phase:         int32(p.Number()),
		Content:       rawResp,
		SchemaVersion: "conceptnet-5.7",
		FetchedAt:     time.Now(),
	}

	// Get the source lexeme ID (the first lexeme for this lemma)
	lexemes, err := p.lexemeRepo.ListByLemmaID(ctx, lemma.ID)
	if err != nil || len(lexemes) == 0 {
		// No lexeme yet — relations can't be created without a source lexeme
		return &PhaseResult{
			Evidence: []*entity.RawEvidence{evidence},
		}, nil
	}
	sourceLexemeID := lexemes[0].ID

	// Convert edges to semantic relations
	relations := make([]*entity.SemanticRelation, 0, len(edges))
	for _, edge := range edges {
		// Determine target term (the other side of the relation)
		targetTerm := edge.EndTerm
		if edge.EndTerm == lemma.Surface {
			targetTerm = edge.StartTerm
		}

		relations = append(relations, &entity.SemanticRelation{
			SourceLexemeID: sourceLexemeID,
			TargetLexemeID: nil, // unresolved
			TargetTerm:     targetTerm,
			RelationType:   edge.RelationType,
			Provider:       "conceptnet",
			Strength:       edge.Weight,
			SenseMapped:    false,
		})
	}

	return &PhaseResult{
		Evidence:  []*entity.RawEvidence{evidence},
		Relations: relations,
	}, nil
}
