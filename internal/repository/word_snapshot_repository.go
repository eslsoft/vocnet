package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// ListSnapshotsQuery holds filter/sort/pagination options for listing snapshots.
type ListSnapshotsQuery struct {
	Language  string
	MinQScore float64
	OrderBy   string // "qscore", "synthesized_at", "term"
	Desc      bool
	PageSize  int32
	PageNo    int32
}

// WordSnapshotRepository manages materialized word snapshots.
type WordSnapshotRepository interface {
	CreateOrUpdate(ctx context.Context, snapshot *entity.WordSnapshot) (*entity.WordSnapshot, error)
	GetByLemma(ctx context.Context, lemmaID int64) (*entity.WordSnapshot, error)
	GetByTerm(ctx context.Context, term string, language string) (*entity.WordSnapshot, error)
	List(ctx context.Context, query *ListSnapshotsQuery) ([]*entity.WordSnapshot, int, error)
}
