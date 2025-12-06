package entity

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// ReviewPlan represents a user's vocabulary review plan configuration.
type ReviewPlan struct {
	ID          int64
	UserID      uuid.UUID
	Name        string
	Description string
	WordbookIDs []int64
	Status      ReviewPlanStatus
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ReviewPlanStatus contains computed statistics about a review plan.
type ReviewPlanStatus struct {
	PendingWords  int32
	MasteredWords int32
	LearningWords int32
	UnknownWords  int32
	Wordbooks     []*Wordbook
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
