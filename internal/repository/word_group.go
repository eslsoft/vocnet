package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListWordGroupQuery struct {
	Pagination
	FilterOrder
}

type WordGroupRepository interface {
	Upsert(ctx context.Context, group *entity.Word) (*entity.Word, error)
	GetByID(ctx context.Context, wordID int64) (*entity.Word, error)
	GetByWID(ctx context.Context, wid string) (*entity.Word, error)
	List(ctx context.Context, query *ListWordGroupQuery) ([]*entity.Word, int64, error)
	DeleteByWID(ctx context.Context, wid string) error
}
