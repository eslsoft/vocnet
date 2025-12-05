package repository

import (
	"context"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/google/uuid"
)

// ListLearnedWordQuery holds parameters for listing user words.
type ListLearnedWordQuery struct {
	Pagination

	UserID uuid.UUID
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
	GetByID(ctx context.Context, userID uuid.UUID, id int64) (*entity.LearnedWord, error)
	FindByTerm(ctx context.Context, userID uuid.UUID, term string, language entity.Language) (*entity.LearnedWord, error)
	List(ctx context.Context, filter *ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteByID(ctx context.Context, userID uuid.UUID, id int64) error
	StatsByTerms(ctx context.Context, userID uuid.UUID, terms []string) (entity.WordbookStats, error)

	// GetByReviewPlan fetches words associated with a review plan's wordbooks.
	// If dueOnly is true, only returns words where next_review_at <= now or next_review_at is null.
	// If limit > 0, restricts the number of results returned.
	GetByReviewPlan(ctx context.Context, userID uuid.UUID, wordbookIDs []int64, dueOnly bool, limit int) ([]*entity.LearnedWord, error)

	// UpdateMasteryAndReview atomically updates mastery scores and review timing for a word.
	UpdateMasteryAndReview(ctx context.Context, id int64, userID uuid.UUID, mastery entity.MasteryBreakdown, review entity.ReviewTiming) error

	// GetByIDs fetches multiple words by their IDs (for batch operations like distractor generation).
	GetByIDs(ctx context.Context, userID uuid.UUID, ids []int64) ([]*entity.LearnedWord, error)
}
