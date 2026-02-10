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
	ListLatestByLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]*entity.WordSnapshot, error)
	ListLatest(ctx context.Context, pageNo int32, pageSize int32, keyword string) ([]*entity.WordSnapshot, int64, error)
	ListByLemmaID(ctx context.Context, lemmaID int64, pageNo int32, pageSize int32) ([]*entity.WordSnapshot, int64, error)
}
