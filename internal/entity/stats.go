package entity

import "time"

// DashboardStats represents the dashboard overview metrics.
type DashboardStats struct {
	// Global Progress
	TotalWords    int32
	MasteredWords int32

	// Today Overview
	TodayReviewedCount int32
	TodayDueWords      int32
	TodayNewWords      int32
	TodayTimeSpent     int32 // seconds

	// Motivation
	StreakDays int32
}

// MasteryDistributionData holds the distribution of words by mastery level.
type MasteryDistributionData struct {
	Distribution map[int32]int32 // key: mastery level (0-5), value: count
	GeneratedAt  time.Time
}

// ActivityCalendarData holds the activity heatmap data.
type ActivityCalendarData struct {
	Activities []DailyActivityData
}

// DailyActivityData represents a single day's activity.
type DailyActivityData struct {
	Date  string // "YYYY-MM-DD"
	Count int32  // Total activity count
	Level int32  // Activity level 0-4 (for heatmap color intensity)
}
