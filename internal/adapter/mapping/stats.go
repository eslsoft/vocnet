package mapping

import (
	"github.com/eslsoft/vocnet/internal/entity"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ToPbDashboardStats converts entity.DashboardStats to proto DashboardStats.
func ToPbDashboardStats(ent *entity.DashboardStats) *learningv1.DashboardStats {
	if ent == nil {
		return nil
	}

	return &learningv1.DashboardStats{
		TotalWords:         ent.TotalWords,
		MasteredWords:      ent.MasteredWords,
		TodayReviewedCount: ent.TodayReviewedCount,
		TodayDueWords:      ent.TodayDueWords,
		TodayNewWords:      ent.TodayNewWords,
		TodayTimeSpent:     ent.TodayTimeSpent,
		StreakDays:         ent.StreakDays,
	}
}

// ToPbMasteryDistribution converts entity.MasteryDistributionData to proto MasteryDistribution.
func ToPbMasteryDistribution(ent *entity.MasteryDistributionData) *learningv1.MasteryDistribution {
	if ent == nil {
		return nil
	}

	return &learningv1.MasteryDistribution{
		Distribution: ent.Distribution,
		GeneratedAt:  timestamppb.New(ent.GeneratedAt),
	}
}

// ToPbActivityCalendar converts entity.ActivityCalendarData to proto ActivityCalendar.
func ToPbActivityCalendar(ent *entity.ActivityCalendarData) *learningv1.ActivityCalendar {
	if ent == nil {
		return nil
	}

	activities := make([]*learningv1.DailyActivity, 0, len(ent.Activities))
	for _, activity := range ent.Activities {
		activities = append(activities, &learningv1.DailyActivity{
			Date:  activity.Date,
			Count: activity.Count,
			Level: activity.Level,
		})
	}

	return &learningv1.ActivityCalendar{
		Activities: activities,
	}
}
