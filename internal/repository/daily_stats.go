package repository

import (
	"context"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/google/uuid"
)

//go:generate mockgen -source=daily_stats.go -destination=../mocks/mock_daily_stats_repository.go -package=mocks

// DailyStatsRepository provides CRUD operations for daily learning statistics per plan.
type DailyStatsRepository interface {
	// GetOrCreate retrieves existing stats for the (user, plan, date) or creates a new zero-value record.
	// The date parameter will be normalized to UTC midnight.
	GetOrCreate(ctx context.Context, userID uuid.UUID, planID int64, date time.Time) (*entity.DailyStats, error)

	// IncrementStats atomically updates daily statistics for a specific plan. Supports concurrent submissions.
	// All increment values should be non-negative. The scoreSum is used to calculate
	// the average score: (old_avg * old_count + scoreSum) / (old_count + cardsReviewed).
	IncrementStats(ctx context.Context, userID uuid.UUID, planID int64, date time.Time,
		cardsReviewed int32, newWords int32, timeSpentSeconds int32,
		scoreSum float32, wordsMastered int32) error

	// GetByPlan retrieves stats for a specific plan on a specific date.
	// Returns nil if no stats exist for this plan and date.
	GetByPlan(ctx context.Context, userID uuid.UUID, planID int64, date time.Time) (*entity.DailyStats, error)

	// GetTodayAllPlans retrieves today's stats for all plans for the given user.
	GetTodayAllPlans(ctx context.Context, userID uuid.UUID) ([]*entity.DailyStats, error)

	// GetRange retrieves stats for a date range (inclusive). Used for calendar/chart views.
	// Results are ordered by date descending.
	GetRange(ctx context.Context, userID uuid.UUID, startDate, endDate time.Time) ([]*entity.DailyStats, error)

	// GetToday retrieves aggregated stats for today across all plans.
	// Returns nil if no stats exist for today yet.
	GetToday(ctx context.Context, userID uuid.UUID) (*entity.DailyStats, error)

	// CountConsecutiveDays calculates the current streak of consecutive days with activity.
	// A day has activity if ANY plan has CardsReviewed > 0 OR NewWords > 0.
	// The streak ends at the first day without activity (working backwards from today).
	CountConsecutiveDays(ctx context.Context, userID uuid.UUID, today time.Time) (int32, error)
}
