package repository

import (
	"context"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/google/uuid"
)

//go:generate mockgen -source=daily_stats.go -destination=../mocks/mock_daily_stats_repository.go -package=mocks

// DailyStatsRepository provides CRUD operations for daily learning statistics.
type DailyStatsRepository interface {
	// GetOrCreate retrieves existing stats for the date or creates a new zero-value record.
	// The date parameter will be normalized to UTC midnight.
	GetOrCreate(ctx context.Context, userID uuid.UUID, date time.Time) (*entity.DailyStats, error)

	// IncrementStats atomically updates daily statistics. Supports concurrent submissions.
	// All increment values should be non-negative. The scoreSum is used to calculate
	// the average score: (old_avg * old_count + scoreSum) / (old_count + cardsReviewed).
	IncrementStats(ctx context.Context, userID uuid.UUID, date time.Time,
		cardsReviewed int32, newWords int32, timeSpentSeconds int32,
		scoreSum float32, wordsMastered int32) error

	// GetRange retrieves stats for a date range (inclusive). Used for calendar/chart views.
	// Results are ordered by date descending.
	GetRange(ctx context.Context, userID uuid.UUID, startDate, endDate time.Time) ([]*entity.DailyStats, error)

	// GetToday retrieves stats for today (normalized to current date).
	// Returns nil if no stats exist for today yet.
	GetToday(ctx context.Context, userID uuid.UUID) (*entity.DailyStats, error)

	// CountConsecutiveDays calculates the current streak of consecutive days with activity.
	// A day has activity if CardsReviewed > 0 OR NewWords > 0.
	// The streak ends at the first day without activity (working backwards from today).
	CountConsecutiveDays(ctx context.Context, userID uuid.UUID, today time.Time) (int32, error)
}
