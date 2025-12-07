package entity

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// ReviewPlanConfig holds configuration for a review plan.
type ReviewPlanConfig struct {
	DailyNewLimit int32
}

// ReviewPlan represents a user's vocabulary review plan configuration.
type ReviewPlan struct {
	ID          int64
	UserID      uuid.UUID
	Name        string
	Description string
	Config      ReviewPlanConfig
	WordbookIDs []int64
	Status      ReviewPlanStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ReviewPlanStatus contains computed statistics about a review plan.
type ReviewPlanStatus struct {
	Inventory InventoryStats
	DailyTask DailyTaskStats
	Wordbooks []*Wordbook
}

type InventoryStats struct {
	TotalWords    int32
	UnknownWords  int32
	LearningWords int32
	MasteredWords int32
}

type DailyTaskStats struct {
	ReviewDue          int32
	NewWordsRemaining  int32
	NewWordsCompleted  int32
	CardsReviewedToday int32
}

// StartOfDay returns the beginning of the user's day in the same location.
func StartOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}

// EndOfDay returns the end-of-day timestamp (inclusive) for the given time.
func EndOfDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 23, 59, 59, int(time.Second-time.Nanosecond), t.Location())
}

// IsReviewDue reports whether the next review time is scheduled and due by the cutoff.
func IsReviewDue(next time.Time, cutoff time.Time) bool {
	if next.IsZero() {
		return false
	}
	return !next.After(cutoff)
}

// NormalizeReviewPlan cleans string fields, sets defaults, and ensures invariants.
func NormalizeReviewPlan(in *ReviewPlan) (*ReviewPlan, error) {
	if in == nil {
		return nil, ErrInvalidInput
	}

	out := *in
	out.Name = strings.TrimSpace(out.Name)
	out.Description = strings.TrimSpace(out.Description)

	if out.Name == "" {
		return nil, ErrInvalidReviewPlanName
	}

	if out.Config.DailyNewLimit <= 0 {
		out.Config.DailyNewLimit = 20 // Default to 20 new words per day
	}

	// Deduplicate wordbook IDs

	// Deduplicate wordbook IDs
	if len(out.WordbookIDs) > 0 {
		seen := make(map[int64]bool)
		unique := make([]int64, 0, len(out.WordbookIDs))
		for _, id := range out.WordbookIDs {
			if id > 0 && !seen[id] {
				seen[id] = true
				unique = append(unique, id)
			}
		}
		out.WordbookIDs = unique
	} else {
		out.WordbookIDs = []int64{}
	}

	return &out, nil
}
