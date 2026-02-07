package pipeline

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// Phase2Lexical implements the lexical phase (extracts senses and forms from Phase 1 evidence).
type Phase2Lexical struct {
	// This phase reuses evidence from Phase 1, so it doesn't need external providers
}

func NewPhase2Lexical() *Phase2Lexical {
	return &Phase2Lexical{}
}

func (p *Phase2Lexical) Name() string {
	return entity.PhaseLexical.Name()
}

func (p *Phase2Lexical) Number() int {
	return int(entity.PhaseLexical)
}

func (p *Phase2Lexical) Execute(ctx context.Context, lemma *entity.Lemma) (*PhaseResult, error) {
	// In MVP, Phase 1 already extracted senses and forms.
	// This phase would normally do additional enrichment or normalization.
	// For now, we just return empty result (no additional work needed).
	return &PhaseResult{}, nil
}
