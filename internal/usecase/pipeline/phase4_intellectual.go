package pipeline

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// Phase4Intellectual implements the intellectual phase (LLM distillation).
// In MVP, this phase is skipped.
type Phase4Intellectual struct{}

func NewPhase4Intellectual() *Phase4Intellectual {
	return &Phase4Intellectual{}
}

func (p *Phase4Intellectual) Name() string {
	return entity.PhaseIntellectual.Name()
}

func (p *Phase4Intellectual) Number() int {
	return int(entity.PhaseIntellectual)
}

func (p *Phase4Intellectual) Execute(ctx context.Context, lemma *entity.Lemma) (*PhaseResult, error) {
	// MVP: Skip this phase — return nil to signal SKIPPED status
	return nil, nil
}
