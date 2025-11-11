package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
)

// ListLearnedWordQuery holds parameters for listing user words.
type ListLearnedWordQuery struct {
	Pagination
	FilterOrder

	UserID int64
}

//go:generate mockgen -source=learned_word.go -destination=../mocks/mock_learned_word_repository.go -package=mocks

// LearnedWordRepository abstracts persistence for user words to keep usecases storage agnostic.
type LearnedWordRepository interface {
	Create(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	Update(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	GetByWordID(ctx context.Context, userID int64, wordID int64) (*entity.LearnedWord, error)
	FindByWordID(ctx context.Context, userID int64, wordID int64) (*entity.LearnedWord, error)
	List(ctx context.Context, filter *ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteByWordID(ctx context.Context, userID int64, wordID int64) error
}
