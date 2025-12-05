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
	CalculateNextReview(current entity.ReviewTiming, scoreNormalized float32) entity.ReviewTiming
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
func (a *SM2Algorithm) CalculateNextReview(current entity.ReviewTiming, scoreNormalized float32) entity.ReviewTiming {
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

	// Step 4: Update fail count
	failCount := current.FailCount
	if scoreNormalized >= PassingScore {
		failCount = 0 // Reset on passing score
	} else {
		failCount++ // Increment on failure
	}

	// Step 5: Reset interval if failed 3+ times consecutively
	if failCount >= 3 {
		newInterval = InitialInterval
	}

	// Step 6: Calculate next review time
	nextReviewAt := now.Add(time.Duration(newInterval) * 24 * time.Hour)

	return entity.ReviewTiming{
		LastReviewAt: now,
		NextReviewAt: nextReviewAt,
		IntervalDays: newInterval,
		FailCount:    failCount,
	}
}
