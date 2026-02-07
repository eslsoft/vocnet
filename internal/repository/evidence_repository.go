package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// EvidenceRepository manages raw evidence envelopes.
type EvidenceRepository interface {
	Create(ctx context.Context, evidence *entity.RawEvidence) (*entity.RawEvidence, error)
	FindByLemma(ctx context.Context, lemmaID int64) ([]*entity.RawEvidence, error)
	FindByLemmaAndPhase(ctx context.Context, lemmaID int64, phase int32) ([]*entity.RawEvidence, error)
}
