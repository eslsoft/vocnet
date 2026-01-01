package usecase

import (
	"context"
	"sort"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"github.com/eslsoft/vocnet/internal/infrastructure/usertime"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=stats_usecase.go -destination=../mocks/mock_stats_usecase.go -package=mocks

// StatsUsecase orchestrates statistics computation workflows.
type StatsUsecase interface {
	GetDashboardStats(ctx context.Context) (*entity.DashboardStats, error)
	GetMasteryDistribution(ctx context.Context) (*entity.MasteryDistributionData, error)
	GetActivityCalendar(ctx context.Context, startTime, endTime time.Time) (*entity.ActivityCalendarData, error)
}

type statsUsecase struct {
	learnedWordRepo repository.LearnedWordRepository
	dailyStatsRepo  repository.DailyStatsRepository
}

// NewStatsUsecase constructs a new stats usecase.
func NewStatsUsecase(
	learnedWordRepo repository.LearnedWordRepository,
	dailyStatsRepo repository.DailyStatsRepository,
) StatsUsecase {
	return &statsUsecase{
		learnedWordRepo: learnedWordRepo,
		dailyStatsRepo:  dailyStatsRepo,
	}
}

// GetDashboardStats retrieves comprehensive dashboard metrics.
func (u *statsUsecase) GetDashboardStats(ctx context.Context) (*entity.DashboardStats, error) {
	userID := auth.MustGetUserID(ctx)

	// Get global stats from LearnedWordRepository
	totalWords, err := u.learnedWordRepo.CountByUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Use new overall score threshold: MASTERED >= 418 (on 0-500 scale)
	masteredWords, err := u.learnedWordRepo.CountMasteredByUser(ctx, userID, 418)
	if err != nil {
		return nil, err
	}

	// Get today's stats from DailyStatsRepository
	todayStats, err := u.dailyStatsRepo.GetToday(ctx, userID)
	var todayReviewed, todayNewWords, todayTimeSpent int32
	if err == nil && todayStats != nil {
		todayReviewed = todayStats.CardsReviewed
		todayNewWords = todayStats.NewWords
		todayTimeSpent = todayStats.TimeSpentSeconds
	} else if err != nil {
		return nil, err
	}

	// Calculate remaining due words for today
	now := usertime.Now(ctx)
	endOfToday := usertime.EndOfToday(ctx)
	todayDue, err := u.learnedWordRepo.CountDueToday(ctx, userID, endOfToday)
	if err != nil {
		return nil, err
	}

	// Calculate streak days
	normalizedToday := entity.NormalizeDate(now)
	streakDays, err := u.dailyStatsRepo.CountConsecutiveDays(ctx, userID, normalizedToday)
	if err != nil {
		return nil, err
	}

	return &entity.DashboardStats{
		TotalWords:         totalWords,
		MasteredWords:      masteredWords,
		TodayReviewedCount: todayReviewed,
		TodayDueWords:      todayDue,
		TodayNewWords:      todayNewWords,
		TodayTimeSpent:     todayTimeSpent,
		StreakDays:         streakDays,
	}, nil
}

// GetMasteryDistribution retrieves vocabulary distribution by mastery level.
func (u *statsUsecase) GetMasteryDistribution(ctx context.Context) (*entity.MasteryDistributionData, error) {
	userID := auth.MustGetUserID(ctx)

	distribution, err := u.learnedWordRepo.GetMasteryDistribution(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Ensure all levels 0-5 are present (even if count is 0)
	for level := int32(0); level <= 5; level++ {
		if _, exists := distribution[level]; !exists {
			distribution[level] = 0
		}
	}

	return &entity.MasteryDistributionData{
		Distribution: distribution,
		GeneratedAt:  time.Now(),
	}, nil
}

// GetActivityCalendar retrieves GitHub-style activity heatmap data.
func (u *statsUsecase) GetActivityCalendar(ctx context.Context, startTime, endTime time.Time) (*entity.ActivityCalendarData, error) {
	userID := auth.MustGetUserID(ctx)

	// Default to last 365 days if not specified
	if startTime.IsZero() {
		endTime = usertime.Now(ctx)
		startTime = endTime.AddDate(-1, 0, 0)
	}
	if endTime.IsZero() {
		endTime = usertime.Now(ctx)
	}

	// Normalize to date boundaries
	startDate := entity.NormalizeDate(startTime)
	endDate := entity.NormalizeDate(endTime)

	// Fetch daily stats for the range
	dailyStats, err := u.dailyStatsRepo.GetRange(ctx, userID, startDate, endDate)
	if err != nil {
		return nil, err
	}

	// Get user's timezone from context
	loc := usertime.MustGetLocation(ctx)

	// Build activity map
	activityMap := make(map[string]int32)
	var allCounts []int32

	for _, stat := range dailyStats {
		// Convert UTC date to user's timezone
		localDate := stat.Date.In(loc)
		dateStr := localDate.Format("2006-01-02")

		// Calculate total activity count
		count := stat.CardsReviewed + stat.NewWords
		if count > 0 {
			activityMap[dateStr] = count
			allCounts = append(allCounts, count)
		}
	}

	// Calculate activity levels using quartile distribution
	levelThresholds := calculateActivityLevels(allCounts)

	// Build result array with all dates in range (including zeros)
	result := make([]entity.DailyActivityData, 0)
	for d := startDate; !d.After(endDate); d = d.AddDate(0, 0, 1) {
		localDate := d.In(loc)
		dateStr := localDate.Format("2006-01-02")
		count := activityMap[dateStr]
		level := determineLevel(count, levelThresholds)

		result = append(result, entity.DailyActivityData{
			Date:  dateStr,
			Count: count,
			Level: level,
		})
	}

	return &entity.ActivityCalendarData{
		Activities: result,
	}, nil
}

// calculateActivityLevels computes quartile-based thresholds for activity levels.
func calculateActivityLevels(counts []int32) []int32 {
	if len(counts) == 0 {
		return []int32{0, 0, 0, 0}
	}

	// Sort counts to find quartiles
	sorted := make([]int32, len(counts))
	copy(sorted, counts)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	q1 := sorted[len(sorted)*1/4]
	q2 := sorted[len(sorted)*2/4]
	q3 := sorted[len(sorted)*3/4]

	return []int32{0, q1, q2, q3}
}

// determineLevel maps activity count to a level (0-4) for heatmap visualization.
func determineLevel(count int32, thresholds []int32) int32 {
	if count == 0 {
		return 0
	}
	if count <= thresholds[1] {
		return 1
	}
	if count <= thresholds[2] {
		return 2
	}
	if count <= thresholds[3] {
		return 3
	}
	return 4
}
