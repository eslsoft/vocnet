package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// ListLearnedLexemeQuery holds parameters for listing user lexemes.
type ListLearnedLexemeQuery struct {
	Pagination
	FilterOrder

	UserID int64
}

//go:generate mockgen -source=learned_lexeme.go -destination=../mocks/mock_learned_lexeme_repository.go -package=mocks

// LearnedLexemeRepository abstracts persistence for user lexemes to keep usecases storage agnostic.
type LearnedLexemeRepository interface {
	Create(ctx context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error)
	Update(ctx context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error)
	GetByLexemeID(ctx context.Context, userID int64, lexemeID int64) (*entity.LearnedLexeme, error)
	FindByLexemeID(ctx context.Context, userID int64, lexemeID int64) (*entity.LearnedLexeme, error)
	List(ctx context.Context, filter *ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error)
	DeleteByLexemeID(ctx context.Context, userID int64, lexemeID int64) error
}
