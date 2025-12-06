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

func (r *dailyStatsRepository) GetOrCreate(ctx context.Context, userID uuid.UUID, date time.Time) (*entity.DailyStats, error) {
	normalizedDate := entity.NormalizeDate(date)

	// Try to get existing record
	rec, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
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

func (r *dailyStatsRepository) IncrementStats(ctx context.Context, userID uuid.UUID, date time.Time,
	cardsReviewed int32, newWords int32, timeSpentSeconds int32,
	scoreSum float32, wordsMastered int32) error {

	normalizedDate := entity.NormalizeDate(date)

	// First, get or create the record to calculate new average
	current, err := r.GetOrCreate(ctx, userID, normalizedDate)
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

// GetToday retrieves stats for today (normalized to current date).
// Returns nil if no stats exist for today yet.
func (r *dailyStatsRepository) GetToday(ctx context.Context, userID uuid.UUID) (*entity.DailyStats, error) {
	normalizedToday := entity.NormalizeDate(time.Now())

	rec, err := r.client.DailyStats.Query().
		Where(
			dailystats.UserIDEQ(userID),
			dailystats.DateEQ(normalizedToday),
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

// CountConsecutiveDays calculates the current streak of consecutive days with activity.
// A day has activity if CardsReviewed > 0 OR NewWords > 0.
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

	// Build a map for quick lookup
	statsMap := make(map[string]*entdb.DailyStats)
	for _, rec := range recs {
		dateStr := rec.Date.Format("2006-01-02")
		statsMap[dateStr] = rec
	}

	// Count consecutive days backwards from today
	var streak int32
	currentDate := normalizedToday

	for i := 0; i <= 365; i++ {
		dateStr := currentDate.Format("2006-01-02")
		stat, exists := statsMap[dateStr]

		if !exists {
			// No record for this date, streak ends
			break
		}

		// Check if there's activity: CardsReviewed > 0 OR NewWords > 0
		if stat.CardsReviewed > 0 || stat.NewWords > 0 {
			streak++
			currentDate = currentDate.AddDate(0, 0, -1)
		} else {
			// No activity on this date, streak ends
			break
		}
	}

	return streak, nil
}
