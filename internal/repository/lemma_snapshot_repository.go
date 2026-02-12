package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListLatestLemmaSnapshotsQuery struct {
	PageNo   int32
	PageSize int32
	Keyword  string

	Categories []string
	Levels     []string
	POS        []string
	MinQScore  *float64

	SortBy   string
	SortDesc bool
}

// LemmaSnapshotRepository manages materialized lemma snapshots.
type LemmaSnapshotRepository interface {
	CreateOrUpdate(ctx context.Context, snapshot *entity.LemmaSnapshot) (*entity.LemmaSnapshot, error)
	GetByLemma(ctx context.Context, lemmaID int64) (*entity.LemmaSnapshot, error)
	GetByTerm(ctx context.Context, term string, language string) (*entity.LemmaSnapshot, error)
	ListLatestByLemmaIDs(ctx context.Context, lemmaIDs []int64) (map[int64]*entity.LemmaSnapshot, error)
	ListLatest(ctx context.Context, query *ListLatestLemmaSnapshotsQuery) ([]*entity.LemmaSnapshot, int64, error)
	ListByLemmaID(ctx context.Context, lemmaID int64, pageNo int32, pageSize int32) ([]*entity.LemmaSnapshot, int64, error)
}
