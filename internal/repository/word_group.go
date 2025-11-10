package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListWordGroupQuery struct {
	Pagination
	FilterOrder
}

//go:generate mockgen -source=word_group.go -destination=../mocks/mock_word_group_repository.go -package=mocks

type WordGroupRepository interface {
	Create(ctx context.Context, group *entity.Word) (*entity.Word, error)
	Update(ctx context.Context, group *entity.Word) (*entity.Word, error)
	Upsert(ctx context.Context, group *entity.Word) (*entity.Word, error)
	Delete(ctx context.Context, wordID int64) error
	GetByID(ctx context.Context, wordID int64) (*entity.Word, error)
	GetByWID(ctx context.Context, wid string) (*entity.Word, error)
	List(ctx context.Context, query *ListWordGroupQuery) ([]*entity.Word, int64, error)
	DeleteByWID(ctx context.Context, wid string) error
}
