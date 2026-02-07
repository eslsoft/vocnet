package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// WordSnapshotRepository manages materialized word snapshots.
type WordSnapshotRepository interface {
	CreateOrUpdate(ctx context.Context, snapshot *entity.WordSnapshot) (*entity.WordSnapshot, error)
	GetByLemma(ctx context.Context, lemmaID int64) (*entity.WordSnapshot, error)
	GetByTerm(ctx context.Context, term string, language string) (*entity.WordSnapshot, error)
}
