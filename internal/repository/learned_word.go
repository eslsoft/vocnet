package repository

import (
	"context"
	"time"

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
	// Auto inherit mastery from lemma for inflected forms
	AutoInheritMastery bool
}

//go:generate mockgen -source=learned_word.go -destination=../mocks/mock_learned_word_repository.go -package=mocks

// LearnedWordRepository abstracts persistence for user words to keep usecases storage agnostic.
type LearnedWordRepository interface {
	Create(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	Update(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	GetByID(ctx context.Context, userID uuid.UUID, id int64) (*entity.LearnedWord, error)
	FindByTerm(ctx context.Context, userID uuid.UUID, term string, language entity.Language) (*entity.LearnedWord, error)
	FindByLexeme(ctx context.Context, userID uuid.UUID, lexemeID int64, normal string) (*entity.LearnedWord, error)
	List(ctx context.Context, filter *ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteByID(ctx context.Context, userID uuid.UUID, id int64) error
	StatsByTerms(ctx context.Context, userID uuid.UUID, terms []string, endOfToday time.Time) (entity.WordbookStats, error)

	// GetByReviewPlan fetches words associated with a review plan's wordbooks.
	// If dueOnly is true, only returns words where next_review_at <= now or next_review_at is null.
	// If limit > 0, restricts the number of results returned.
	GetByReviewPlan(ctx context.Context, userID uuid.UUID, wordbookIDs []int64, dueOnly bool, limit int) ([]*entity.LearnedWord, error)

	// UpdateMasteryAndReview atomically updates mastery scores and review timing for a word.
	UpdateMasteryAndReview(ctx context.Context, id int64, userID uuid.UUID, mastery entity.MasteryBreakdown, review entity.ReviewTiming) error

	// GetByIDs fetches multiple words by their IDs (for batch operations like distractor generation).
	GetByIDs(ctx context.Context, userID uuid.UUID, ids []int64) ([]*entity.LearnedWord, error)

	// CountByUser returns the total number of learned words for a user.
	CountByUser(ctx context.Context, userID uuid.UUID) (int32, error)

	// CountMasteredByUser returns the count of words with mastery >= masteryThreshold.
	CountMasteredByUser(ctx context.Context, userID uuid.UUID, masteryThreshold int32) (int32, error)

	// CountDueToday returns the count of words due for review (NextReviewAt <= endOfToday).
	CountDueToday(ctx context.Context, userID uuid.UUID, endOfToday time.Time) (int32, error)

	// GetMasteryDistribution returns a map of mastery level (0-5) to word count.
	GetMasteryDistribution(ctx context.Context, userID uuid.UUID) (map[int32]int32, error)
}
