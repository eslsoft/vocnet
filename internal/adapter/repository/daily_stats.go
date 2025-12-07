package repository

import (
	"context"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/database/ent/dailystats"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/google/uuid"
)

type dailyStatsRepository struct {
	client *entdb.Client
}

// NewDailyStatsRepository constructs an ent-backed repository.
func NewDailyStatsRepository(client *entdb.Client) repository.DailyStatsRepository {
	return &dailyStatsRepository{
		client: client,
	}
}

func (r *dailyStatsRepository) GetOrCreate(ctx context.Context, userID uuid.UUID, planID int64, date time.Time) (*entity.DailyStats, error) {
	normalizedDate := entity.NormalizeDate(date)

	// Try to get existing record
	rec, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.PlanIDEQ(planID),
			dailystats.DateEQ(normalizedDate),
		).
		First(ctx)

	if err == nil {
		return mapEntDailyStats(rec), nil
	}

	if !entdb.IsNotFound(err) {
		return nil, err
	}

	// Create new record with zero values
	rec, err = r.client.DailyStats.Create().
		SetUserID(userID).
		SetPlanID(planID).
		SetDate(normalizedDate).
		SetCardsReviewed(0).
		SetNewWords(0).
		SetTimeSpentSeconds(0).
		SetAverageScore(0.0).
		SetWordsMastered(0).
		Save(ctx)

	if err != nil {
		return nil, err
	}

	return mapEntDailyStats(rec), nil
}

func (r *dailyStatsRepository) IncrementStats(ctx context.Context, userID uuid.UUID, planID int64, date time.Time,
	cardsReviewed int32, newWords int32, timeSpentSeconds int32,
	scoreSum float32, wordsMastered int32) error {

	normalizedDate := entity.NormalizeDate(date)

	// First, get or create the record to calculate new average
	current, err := r.GetOrCreate(ctx, userID, planID, normalizedDate)
	if err != nil {
		return err
	}

	// Calculate new average score: (old_avg * old_count + scoreSum) / (old_count + new_count)
	var newAverage float32
	if current.CardsReviewed == 0 {
		newAverage = scoreSum
	} else {
		totalScore := current.AverageScore*float32(current.CardsReviewed) + scoreSum
		newAverage = totalScore / float32(current.CardsReviewed+cardsReviewed)
	}

	// Use atomic SQL operations to handle concurrent updates
	return r.client.DailyStats.Update().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.PlanIDEQ(planID),
			dailystats.DateEQ(normalizedDate),
		).
		AddCardsReviewed(cardsReviewed).
		AddNewWords(newWords).
		AddTimeSpentSeconds(timeSpentSeconds).
		AddWordsMastered(wordsMastered).
		SetAverageScore(newAverage).
		Exec(ctx)
}

func (r *dailyStatsRepository) GetRange(ctx context.Context, userID uuid.UUID, startDate, endDate time.Time) ([]*entity.DailyStats, error) {
	normalizedStart := entity.NormalizeDate(startDate)
	normalizedEnd := entity.NormalizeDate(endDate)

	recs, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.DateGTE(normalizedStart),
			dailystats.DateLTE(normalizedEnd),
		).
		Order(entdb.Desc(dailystats.FieldDate)).
		All(ctx)

	if err != nil {
		return nil, err
	}

	result := make([]*entity.DailyStats, 0, len(recs))
	for _, rec := range recs {
		result = append(result, mapEntDailyStats(rec))
	}

	return result, nil
}

func mapEntDailyStats(rec *entdb.DailyStats) *entity.DailyStats {
	if rec == nil {
		return nil
	}

	return &entity.DailyStats{
		ID:               rec.ID,
		UserID:           rec.UserID,
		PlanID:           rec.PlanID,
		Date:             rec.Date,
		CardsReviewed:    rec.CardsReviewed,
		NewWords:         rec.NewWords,
		TimeSpentSeconds: rec.TimeSpentSeconds,
		AverageScore:     rec.AverageScore,
		WordsMastered:    rec.WordsMastered,
		CreatedAt:        rec.CreatedAt,
		UpdatedAt:        rec.UpdatedAt,
	}
}

// GetByPlan retrieves stats for a specific plan on a specific date.
// Returns nil if no stats exist for this plan and date.
func (r *dailyStatsRepository) GetByPlan(ctx context.Context, userID uuid.UUID, planID int64, date time.Time) (*entity.DailyStats, error) {
	normalizedDate := entity.NormalizeDate(date)

	rec, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.PlanIDEQ(planID),
			dailystats.DateEQ(normalizedDate),
		).
		First(ctx)

	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil
		}
		return nil, err
	}

	return mapEntDailyStats(rec), nil
}

// GetTodayAllPlans retrieves today's stats for all plans for the given user.
func (r *dailyStatsRepository) GetTodayAllPlans(ctx context.Context, userID uuid.UUID) ([]*entity.DailyStats, error) {
	normalizedToday := entity.NormalizeDate(time.Now())

	recs, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.DateEQ(normalizedToday),
		).
		All(ctx)

	if err != nil {
		return nil, err
	}

	result := make([]*entity.DailyStats, 0, len(recs))
	for _, rec := range recs {
		result = append(result, mapEntDailyStats(rec))
	}

	return result, nil
}

// GetToday retrieves aggregated stats for today across all plans.
// Returns nil if no stats exist for today yet.
func (r *dailyStatsRepository) GetToday(ctx context.Context, userID uuid.UUID) (*entity.DailyStats, error) {
	stats, err := r.GetTodayAllPlans(ctx, userID)
	if err != nil {
		return nil, err
	}

	if len(stats) == 0 {
		return nil, nil
	}

	// Aggregate across all plans
	aggregated := &entity.DailyStats{
		UserID:           userID,
		Date:             entity.NormalizeDate(time.Now()),
		CardsReviewed:    0,
		NewWords:         0,
		TimeSpentSeconds: 0,
		WordsMastered:    0,
	}

	var totalScoreSum float32
	for _, stat := range stats {
		aggregated.CardsReviewed += stat.CardsReviewed
		aggregated.NewWords += stat.NewWords
		aggregated.TimeSpentSeconds += stat.TimeSpentSeconds
		aggregated.WordsMastered += stat.WordsMastered
		totalScoreSum += stat.AverageScore * float32(stat.CardsReviewed)
	}

	if aggregated.CardsReviewed > 0 {
		aggregated.AverageScore = totalScoreSum / float32(aggregated.CardsReviewed)
	}

	return aggregated, nil
}

// CountConsecutiveDays calculates the current streak of consecutive days with activity.
// A day has activity if ANY plan has CardsReviewed > 0 OR NewWords > 0.
// The streak ends at the first day without activity (working backwards from today).
func (r *dailyStatsRepository) CountConsecutiveDays(ctx context.Context, userID uuid.UUID, today time.Time) (int32, error) {
	normalizedToday := entity.NormalizeDate(today)
	// Limit to last 365 days to prevent unbounded scans
	startDate := normalizedToday.AddDate(0, 0, -365)

	// Fetch stats in descending order (most recent first)
	recs, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.DateGTE(startDate),
			dailystats.DateLTE(normalizedToday),
		).
		Order(entdb.Desc(dailystats.FieldDate)).
		All(ctx)

	if err != nil {
		return 0, err
	}

	// Group by date and check if any plan has activity
	dateActivityMap := make(map[string]bool)
	for _, rec := range recs {
		dateStr := rec.Date.Format("2006-01-02")
		if rec.CardsReviewed > 0 || rec.NewWords > 0 {
			dateActivityMap[dateStr] = true
		}
	}

	// Count consecutive days backwards from today
	var streak int32
	currentDate := normalizedToday

	for i := 0; i <= 365; i++ {
		dateStr := currentDate.Format("2006-01-02")
		if dateActivityMap[dateStr] {
			streak++
			currentDate = currentDate.AddDate(0, 0, -1)
		} else {
			// No activity on this date, streak ends
			break
		}
	}

	return streak, nil
}
