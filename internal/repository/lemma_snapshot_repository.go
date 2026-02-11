package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// LemmaSnapshotRepository manages materialized lemma snapshots.
type LemmaSnapshotRepository interface {
	CreateOrUpdate(ctx context.Context, snapshot *entity.LemmaSnapshot) (*entity.LemmaSnapshot, error)
	GetByLemma(ctx context.Context, lemmaID int64) (*entity.LemmaSnapshot, error)
	GetByTerm(ctx context.Context, term string, language string) (*entity.LemmaSnapshot, error)
	ListLatestByLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]*entity.LemmaSnapshot, error)
	ListLatest(ctx context.Context, pageNo int32, pageSize int32, keyword string) ([]*entity.LemmaSnapshot, int64, error)
	ListByLemmaID(ctx context.Context, lemmaID int64, pageNo int32, pageSize int32) ([]*entity.LemmaSnapshot, int64, error)
}
