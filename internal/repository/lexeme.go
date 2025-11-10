package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

type ListLexemeQuery struct {
	Pagination
	FilterOrder
}

//go:generate mockgen -source=lexeme.go -destination=../mocks/mock_lexeme_repository.go -package=mocks

// LexemeRepository defines data access for lexeme entries.
type LexemeRepository interface {
	Create(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error)
	Update(ctx context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error)
	GetByID(ctx context.Context, lexemeID int64) (*entity.Lexeme, error)
	Lookup(ctx context.Context, surfaceForm string, language entity.Language) (*entity.Lexeme, error)
	List(ctx context.Context, filter *ListLexemeQuery) ([]*entity.Lexeme, int64, error)
	ListByWordID(ctx context.Context, wordID int64) ([]*entity.Lexeme, error)
	ListByIDs(ctx context.Context, ids []int64) ([]*entity.Lexeme, error)
	Delete(ctx context.Context, lexemeID int64) error
}
