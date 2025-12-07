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
	Date             time.Time // Normalized to UTC midnight
	CardsReviewed    int32
	NewWords         int32
	TimeSpentSeconds int32
	AverageScore     float32 // 0.0-1.0
	WordsMastered    int32
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// NormalizeDate ensures date is at midnight UTC (strips time component).
// This function is used to ensure consistent date representation across the system.
func NormalizeDate(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
