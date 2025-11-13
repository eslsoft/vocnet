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
	// Parsed filter parameters (populated by connectrpc layer)
	Keyword      string
	Language     string
	SurfaceTerms []string
	Tags         []string
	Categories   []string
	// Parsed order parameters (populated by connectrpc layer)
	PrimaryKey    string
	PrimaryDesc   bool
	SecondaryKey  string
	SecondaryDesc bool
}

//go:generate mockgen -source=learned_word.go -destination=../mocks/mock_learned_word_repository.go -package=mocks

// LearnedWordRepository abstracts persistence for user words to keep usecases storage agnostic.
type LearnedWordRepository interface {
	Create(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	Update(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	GetByID(ctx context.Context, userID int64, id int64) (*entity.LearnedWord, error)
	FindByTerm(ctx context.Context, userID int64, term string, language entity.Language) (*entity.LearnedWord, error)
	List(ctx context.Context, filter *ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteByID(ctx context.Context, userID int64, id int64) error
}
