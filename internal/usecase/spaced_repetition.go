package usecase

import (
	"math"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
)

const (
	// InitialInterval is the starting review interval for new words (1 day).
	InitialInterval = 1

	// MaxInterval is the maximum review interval (180 days / 6 months).
	MaxInterval = 180

	// PassingScore is the threshold for considering an answer correct (60%).
	PassingScore = 0.6
)

// ReviewAlgorithm defines the interface for spaced repetition algorithms.
type ReviewAlgorithm interface {
	// CalculateNextReview calculates the next review timing based on the word's current state and performance.
	// The word parameter includes both mastery and review data for FSRS mapping.
	CalculateNextReview(word *entity.LearnedWord, scoreNormalized float32) entity.ReviewTiming
}

// SM2Algorithm implements a simplified SM-2 spaced repetition algorithm for MVP.
type SM2Algorithm struct{}

// NewSM2Algorithm creates a new SM-2 algorithm instance.
func NewSM2Algorithm() ReviewAlgorithm {
	return &SM2Algorithm{}
}

// CalculateNextReview computes the next review timing based on current state and performance.
// The algorithm adjusts review intervals based on the normalized score (0.0-1.0):
// - score >= 0.9: Excellent (2x interval)
// - 0.6 <= score < 0.9: Good (1.5x interval)
// - score < 0.6: Failed (0.5x interval)
//
// Special cases:
// - First review: starts with InitialInterval (1 day)
// - Three consecutive failures: resets interval to InitialInterval
// - Intervals are clamped to [1, MaxInterval] range
//
// NOTE: fail_count is now cumulative (not reset on success) for FSRS compatibility.
func (a *SM2Algorithm) CalculateNextReview(word *entity.LearnedWord, scoreNormalized float32) entity.ReviewTiming {
	current := word.Review
	now := time.Now()

	// Step 1: Determine current interval (default to InitialInterval for first review)
	currentInterval := current.IntervalDays
	if currentInterval == 0 {
		currentInterval = InitialInterval
	}

	// Step 2: Select ease factor based on score
	var easeFactor float32
	switch {
	case scoreNormalized >= 0.9:
		easeFactor = 2.0 // Very proficient - double the interval
	case scoreNormalized >= PassingScore:
		easeFactor = 1.5 // Passing - increase interval by 50%
	default:
		easeFactor = 0.5 // Failed - reduce interval by half
	}

	// Step 3: Calculate new interval
	newInterval := int32(math.Ceil(float64(currentInterval) * float64(easeFactor)))

	// Clamp to valid range
	if newInterval < 1 {
		newInterval = 1
	}
	if newInterval > MaxInterval {
		newInterval = MaxInterval
	}

	// Step 4: Update fail count (cumulative, no longer reset)
	failCount := current.FailCount
	if scoreNormalized < PassingScore {
		failCount++ // Increment on failure only
	}
	// Note: fail_count is no longer reset on success for FSRS compatibility

	// Step 5: Reset interval if failed 3+ times consecutively
	// (This still uses the cumulative count for backward compatibility)
	if failCount >= 3 {
		newInterval = InitialInterval
	}

	// Step 6: Increment reps (total review count)
	reps := current.Reps + 1

	// Step 7: Calculate next review time
	nextReviewAt := now.Add(time.Duration(newInterval) * 24 * time.Hour)

	return entity.ReviewTiming{
		LastReviewAt: now,
		NextReviewAt: nextReviewAt,
		IntervalDays: newInterval,
		FailCount:    failCount, // Cumulative failure count
		Reps:         reps,      // Total reviews
	}
}
