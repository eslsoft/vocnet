package pipeline

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// Phase represents a single stage in the distillation pipeline.
type Phase interface {
	Name() string
	Number() int
	Execute(ctx context.Context, lemma *entity.Lemma) (*PhaseResult, error)
}

// PhaseResult contains the outputs of a phase execution.
type PhaseResult struct {
	Evidence    []*entity.RawEvidence
	Lexemes     []*entity.Lexeme
	Relations   []*entity.SemanticRelation
	LemmaUpdate *entity.Lemma // non-nil if the lemma should be updated (e.g. QID set)
}
