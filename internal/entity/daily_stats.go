package entity

import (
	"time"

	"github.com/google/uuid"
)

// DailyStats represents daily learning statistics for a user per review plan.
type DailyStats struct {
	ID               int64
	UserID           uuid.UUID
	PlanID           int64
	Date             time.Time // User's local date stored as UTC midnight (YYYY-MM-DD 00:00:00 UTC)
	CardsReviewed    int32
	NewWords         int32
	TimeSpentSeconds int32
	AverageScore     float32 // 0.0-1.0
	WordsMastered    int32
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// NormalizeDate converts a timestamp to a date identifier stored as UTC midnight.
// It extracts the date in the input's timezone, then returns that date at UTC midnight.
//
// Example:
//   Input:  2025-12-08 20:30:00 CST (UTC+8)
//   Output: 2025-12-08 00:00:00 UTC
//
// This ensures:
// - Database always stores UTC midnight (consistent format)
// - Date represents user's local calendar day
// - Works correctly with timezone changes (travel)
func NormalizeDate(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
