package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListLemmaQuery struct {
	Pagination
	FilterOrder
}

//go:generate mockgen -source=lemma.go -destination=../mocks/mock_lemma_repository.go -package=mocks

type LemmaRepository interface {
	Create(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	Update(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	Upsert(ctx context.Context, lemma *entity.Lemma) (*entity.Lemma, error)
	Delete(ctx context.Context, lemmaID int64) error
	GetByID(ctx context.Context, lemmaID int64) (*entity.Lemma, error)
	GetByWID(ctx context.Context, wid string) (*entity.Lemma, error)
	List(ctx context.Context, query *ListLemmaQuery) ([]*entity.Lemma, int64, error)
	DeleteByWID(ctx context.Context, wid string) error
	ListCategories(ctx context.Context, search string) ([]string, error)
	Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error)
}
