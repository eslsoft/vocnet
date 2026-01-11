package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

//go:generate mockgen -source=lemma.go -destination=../mocks/mock_lemma_repository.go -package=mocks

type LemmaRepository interface {
	// Query operations (read-only)
	GetByID(ctx context.Context, lemmaID int64) (*entity.Lemma, error)
	LookupByForm(ctx context.Context, surface string, language entity.Language) (*entity.Lemma, error)
	List(ctx context.Context, query *ListWordsQuery) ([]*entity.Lemma, int64, error)
	ListCategories(ctx context.Context, search string) ([]string, error)
	Stats(ctx context.Context, filter *entity.WordStatsFilter) (*entity.WordStats, error)
}
