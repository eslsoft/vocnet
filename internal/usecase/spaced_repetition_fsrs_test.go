package usecase

import (
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/stretchr/testify/assert"
)

// TestAccuracyToRating verifies the accuracy-to-rating mapping.
func TestAccuracyToRating(t *testing.T) {
	algo := NewFSRSAlgorithm().(*FSRSAlgorithm)

	tests := []struct {
		name     string
		accuracy float32
		expected fsrs.Rating
	}{
		{"Very Low - Again", 0.5, fsrs.Again},
		{"Below Threshold - Again", 0.59, fsrs.Again},
		{"Low Pass - Hard", 0.6, fsrs.Hard},
		{"Mid Hard - Hard", 0.7, fsrs.Hard},
		{"Below Good - Hard", 0.74, fsrs.Hard},
		{"Good Start - Good", 0.75, fsrs.Good},
		{"Mid Good - Good", 0.85, fsrs.Good},
		{"Below Easy - Good", 0.94, fsrs.Good},
		{"Easy Start - Easy", 0.95, fsrs.Easy},
		{"Perfect - Easy", 1.0, fsrs.Easy},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := algo.accuracyToRating(tt.accuracy)
			assert.Equal(t, tt.expected, result, "accuracy %.2f should map to rating %d", tt.accuracy, tt.expected)
		})
	}
}

// TestCalculateStabilityFromMastery verifies stability calculation from mastery dimensions.
func TestCalculateStabilityFromMastery(t *testing.T) {
	algo := NewFSRSAlgorithm().(*FSRSAlgorithm)

	tests := []struct {
		name            string
		mastery         entity.MasteryBreakdown
		currentInterval int32
		expectedMin     float64
		expectedMax     float64
	}{
		{
			name:            "High Mastery + Long Interval",
			mastery:         entity.MasteryBreakdown{Listen: 5, Read: 5, Spell: 4, Pronounce: 5},
			currentInterval: 30,
			expectedMin:     55.0,
			expectedMax:     65.0,
		},
		{
			name:            "Low Mastery + Short Interval",
			mastery:         entity.MasteryBreakdown{Listen: 1, Read: 2, Spell: 0, Pronounce: 0},
			currentInterval: 1,
			expectedMin:     0.5,
			expectedMax:     2.0,
		},
		{
			name:            "New Word - Mastered Level",
			mastery:         entity.MasteryBreakdown{Listen: 5, Read: 5, Spell: 5, Pronounce: 5},
			currentInterval: 0,
			expectedMin:     10.0,
			expectedMax:     10.0,
		},
		{
			name:            "New Word - Proficient Level",
			mastery:         entity.MasteryBreakdown{Listen: 4, Read: 4, Spell: 3, Pronounce: 4},
			currentInterval: 0,
			expectedMin:     5.0,
			expectedMax:     5.0,
		},
		{
			name:            "New Word - Understood Level",
			mastery:         entity.MasteryBreakdown{Listen: 3, Read: 3, Spell: 2, Pronounce: 2},
			currentInterval: 0,
			expectedMin:     2.5,
			expectedMax:     2.5,
		},
		{
			name:            "New Word - Recognized Level",
			mastery:         entity.MasteryBreakdown{Listen: 2, Read: 2, Spell: 1, Pronounce: 1},
			currentInterval: 0,
			expectedMin:     1.0,
			expectedMax:     1.0,
		},
		{
			name:            "New Word - Unknown Level",
			mastery:         entity.MasteryBreakdown{Listen: 1, Read: 1, Spell: 0, Pronounce: 0},
			currentInterval: 0,
			expectedMin:     0.4,
			expectedMax:     0.4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stability := algo.calculateStabilityFromMastery(tt.mastery, tt.currentInterval)
			assert.GreaterOrEqual(t, stability, tt.expectedMin, "stability should be >= %.2f", tt.expectedMin)
			assert.LessOrEqual(t, stability, tt.expectedMax, "stability should be <= %.2f", tt.expectedMax)
		})
	}
}

// TestCalculateDifficultyFromMastery verifies difficulty calculation from overall score.
func TestCalculateDifficultyFromMastery(t *testing.T) {
	algo := NewFSRSAlgorithm().(*FSRSAlgorithm)

	tests := []struct {
		name     string
		overall  int32
		expected float64
	}{
		{"Completely Unknown (0)", 0, 10.0},
		{"Unknown (90)", 90, 8.38},
		{"Recognized (162)", 162, 7.08},
		{"Understood (278)", 278, 5.0},
		{"Proficient (348)", 348, 3.73},
		{"Mastered (488)", 488, 1.21},
		{"Perfect (500)", 500, 1.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mastery := entity.MasteryBreakdown{Overall: tt.overall}
			difficulty := algo.calculateDifficultyFromMastery(mastery)
			assert.InDelta(t, tt.expected, difficulty, 0.01, "overall %d should map to difficulty %.2f", tt.overall, tt.expected)
		})
	}
}

// TestMasteryLevelToFSRSState verifies state mapping from mastery level.
func TestMasteryLevelToFSRSState(t *testing.T) {
	algo := NewFSRSAlgorithm().(*FSRSAlgorithm)

	tests := []struct {
		name     string
		level    entity.MasteryLevel
		reps     uint64
		expected fsrs.State
	}{
		// New word (reps == 0)
		{"New Word - Understood", entity.MasteryLevelUnderstood, 0, fsrs.New},
		{"New Word - Mastered", entity.MasteryLevelMastered, 0, fsrs.New},

		// Low mastery → Learning
		{"Unknown + Low Reps", entity.MasteryLevelUnknown, 2, fsrs.Learning},
		{"Recognized + Low Reps", entity.MasteryLevelRecognized, 3, fsrs.Learning},

		// High mastery → Review
		{"Understood + Reps", entity.MasteryLevelUnderstood, 5, fsrs.Review},
		{"Proficient + Reps", entity.MasteryLevelProficient, 5, fsrs.Review},
		{"Mastered + Reps", entity.MasteryLevelMastered, 5, fsrs.Review},

		// Unspecified level
		{"Unspecified + Low Reps", entity.MasteryLevelUnspecified, 2, fsrs.Learning},
		{"Unspecified + High Reps", entity.MasteryLevelUnspecified, 5, fsrs.Review},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state := algo.masteryLevelToFSRSState(tt.level, tt.reps)
			assert.Equal(t, tt.expected, state, "level %d with reps %d should map to state %d", tt.level, tt.reps, tt.expected)
		})
	}
}

// TestCalculateNextReview_Integration verifies the complete review calculation flow.
func TestCalculateNextReview_Integration(t *testing.T) {
	algo := NewFSRSAlgorithm()

	tests := []struct {
		name             string
		word             *entity.LearnedWord
		accuracy         float32
		expectIntervalGT int32 // Expected interval greater than
		expectRepsIncr   bool  // Expect reps incremented
	}{
		{
			name: "Good Performance - Interval Should Increase",
			word: &entity.LearnedWord{
				Mastery: entity.MasteryBreakdown{
					Listen:    3,
					Read:      4,
					Spell:     2,
					Pronounce: 3,
					Overall:   278, // Understood
				},
				Review: entity.ReviewTiming{
					IntervalDays: 7,
					Reps:         5,
					FailCount:    1,
					LastReviewAt: time.Now().Add(-7 * 24 * time.Hour),
				},
			},
			accuracy:         0.85, // Good
			expectIntervalGT: 7,
			expectRepsIncr:   true,
		},
		{
			name: "Poor Performance - Interval May Decrease",
			word: &entity.LearnedWord{
				Mastery: entity.MasteryBreakdown{
					Listen:    2,
					Read:      2,
					Spell:     1,
					Pronounce: 1,
					Overall:   162, // Recognized
				},
				Review: entity.ReviewTiming{
					IntervalDays: 3,
					Reps:         2,
					FailCount:    1,
					LastReviewAt: time.Now().Add(-3 * 24 * time.Hour),
				},
			},
			accuracy:         0.5, // Again
			expectIntervalGT: 0,
			expectRepsIncr:   true,
		},
		{
			name: "New Word - First Review",
			word: &entity.LearnedWord{
				Mastery: entity.MasteryBreakdown{
					Listen:    0,
					Read:      0,
					Spell:     0,
					Pronounce: 0,
					Overall:   0,
				},
				Review: entity.ReviewTiming{
					IntervalDays: 0,
					Reps:         0,
					FailCount:    0,
				},
			},
			accuracy:         0.8, // Good
			expectIntervalGT: 0,
			expectRepsIncr:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := algo.CalculateNextReview(tt.word, tt.accuracy)

			// Verify interval expectations
			if tt.expectIntervalGT > 0 {
				assert.Greater(t, result.IntervalDays, tt.expectIntervalGT, "interval should increase for good performance")
			} else {
				assert.GreaterOrEqual(t, result.IntervalDays, int32(0), "interval should be non-negative")
			}

			// Verify reps incremented
			if tt.expectRepsIncr {
				assert.Equal(t, tt.word.Review.Reps+1, result.Reps, "reps should increment by 1")
			}

			// Verify fail_count behavior
			if tt.accuracy < PassingScore {
				assert.Equal(t, tt.word.Review.FailCount+1, result.FailCount, "fail_count should increment on failure")
			} else {
				assert.Equal(t, tt.word.Review.FailCount, result.FailCount, "fail_count should not change on success")
			}

			// Verify NextReviewAt is in the future
			assert.True(t, result.NextReviewAt.After(time.Now()), "NextReviewAt should be in the future")

			// Verify LastReviewAt is recent
			assert.WithinDuration(t, time.Now(), result.LastReviewAt, 5*time.Second, "LastReviewAt should be recent")
		})
	}
}

// TestCalculateNextReview_FailCountAccumulation verifies fail_count is cumulative (not reset).
func TestCalculateNextReview_FailCountAccumulation(t *testing.T) {
	algo := NewFSRSAlgorithm()

	word := &entity.LearnedWord{
		Mastery: entity.MasteryBreakdown{Overall: 200},
		Review:  entity.ReviewTiming{FailCount: 2, Reps: 3, IntervalDays: 5},
	}

	// Test 1: Fail → FailCount should increment
	result1 := algo.CalculateNextReview(word, 0.4) // Again
	assert.Equal(t, int32(3), result1.FailCount, "fail_count should increment on failure")
	assert.Equal(t, int32(4), result1.Reps, "reps should increment")

	// Test 2: Success → FailCount should NOT reset (cumulative)
	word.Review.FailCount = result1.FailCount
	word.Review.Reps = result1.Reps
	result2 := algo.CalculateNextReview(word, 0.8) // Good

	assert.Equal(t, int32(3), result2.FailCount, "fail_count should remain unchanged on success (cumulative)")
	assert.Equal(t, int32(5), result2.Reps, "reps should continue incrementing")
}

// TestBuildFSRSCardFromMastery verifies FSRS Card construction from mastery data.
func TestBuildFSRSCardFromMastery(t *testing.T) {
	algo := NewFSRSAlgorithm().(*FSRSAlgorithm)

	now := time.Now()
	lastReview := now.Add(-5 * 24 * time.Hour)

	word := &entity.LearnedWord{
		Mastery: entity.MasteryBreakdown{
			Listen:    3,
			Read:      4,
			Spell:     2,
			Pronounce: 3,
			Overall:   278,
		},
		Review: entity.ReviewTiming{
			LastReviewAt: lastReview,
			NextReviewAt: now.Add(2 * 24 * time.Hour),
			IntervalDays: 7,
			FailCount:    2,
			Reps:         5,
		},
	}

	card := algo.buildFSRSCardFromMastery(word, now)

	// Verify basic mappings
	assert.Equal(t, word.Review.NextReviewAt, card.Due, "Due should match NextReviewAt")
	assert.Equal(t, uint64(7), card.ScheduledDays, "ScheduledDays should match IntervalDays")
	assert.Equal(t, uint64(5), card.Reps, "Reps should match")
	assert.Equal(t, uint64(2), card.Lapses, "Lapses should match FailCount")
	assert.Equal(t, lastReview, card.LastReview, "LastReview should match")

	// Verify calculated values
	assert.Greater(t, card.Stability, 0.0, "Stability should be positive")
	assert.Greater(t, card.Difficulty, 0.0, "Difficulty should be positive")
	assert.LessOrEqual(t, card.Difficulty, 10.0, "Difficulty should be <= 10")
	assert.Equal(t, uint64(5), card.ElapsedDays, "ElapsedDays should be ~5 days")

	// Verify state mapping (Understood level with reps > 0 should be Review)
	assert.Equal(t, fsrs.Review, card.State, "State should be Review for Understood level with reps > 0")
}
