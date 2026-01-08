package usecase

import (
	"math"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	fsrs "github.com/open-spaced-repetition/go-fsrs/v3"
)

// FSRSAlgorithm implements ReviewAlgorithm using FSRS-4.5 with Mastery mapping.
// It dynamically calculates FSRS parameters (stability, difficulty, state) from mastery data,
// eliminating the need to store redundant FSRS state in the database.
type FSRSAlgorithm struct {
	fsrs *fsrs.FSRS
}

// NewFSRSAlgorithm creates FSRS algorithm with default parameters.
func NewFSRSAlgorithm() ReviewAlgorithm {
	return &FSRSAlgorithm{
		fsrs: fsrs.NewFSRS(fsrs.DefaultParam()),
	}
}

// CalculateNextReview implements ReviewAlgorithm interface.
// It maps mastery data to FSRS parameters, calculates the next review time,
// and returns updated review timing.
func (a *FSRSAlgorithm) CalculateNextReview(word *entity.LearnedWord, scoreNormalized float32) entity.ReviewTiming {
	current := word.Review
	now := time.Now()

	// Step 1: Build FSRS Card from mastery data
	card := a.buildFSRSCardFromMastery(word, now)

	// Step 2: Map accuracy (0-1) to FSRS Rating (1-4)
	rating := a.accuracyToRating(scoreNormalized)

	// Step 3: Call FSRS algorithm to calculate next review
	recordLog := a.fsrs.Repeat(card, now)
	schedulingInfo := recordLog[rating]
	scheduledCard := schedulingInfo.Card

	// Step 4: Convert back to ReviewTiming
	return a.toReviewTiming(scheduledCard, current, scoreNormalized)
}

// buildFSRSCardFromMastery constructs an FSRS Card from word's mastery and review data.
func (a *FSRSAlgorithm) buildFSRSCardFromMastery(word *entity.LearnedWord, now time.Time) fsrs.Card {
	m := word.Mastery
	r := word.Review

	// Calculate FSRS parameters from mastery
	stability := a.calculateStabilityFromMastery(m, r.IntervalDays)
	difficulty := a.calculateDifficultyFromMastery(m)
	masteryLevel := m.CalculateMasteryLevel()
	state := a.masteryLevelToFSRSState(masteryLevel, uint64(r.Reps))

	// Calculate elapsed_days
	var elapsedDays uint64
	if !r.LastReviewAt.IsZero() {
		elapsedDays = uint64(now.Sub(r.LastReviewAt).Hours() / 24)
	}

	return fsrs.Card{
		Due:           r.NextReviewAt,
		Stability:     stability,
		Difficulty:    difficulty,
		ElapsedDays:   elapsedDays,
		ScheduledDays: uint64(r.IntervalDays),
		Reps:          uint64(r.Reps),
		Lapses:        uint64(r.FailCount), // fail_count is now cumulative
		State:         state,
		LastReview:    r.LastReviewAt,
	}
}

// toReviewTiming converts FSRS Card back to ReviewTiming.
func (a *FSRSAlgorithm) toReviewTiming(card fsrs.Card, original entity.ReviewTiming, accuracy float32) entity.ReviewTiming {
	// Update fail_count (cumulative)
	failCount := original.FailCount
	if accuracy < PassingScore {
		failCount++
	}

	// Increment reps
	reps := original.Reps + 1

	return entity.ReviewTiming{
		LastReviewAt: card.LastReview,
		NextReviewAt: card.Due,
		IntervalDays: int32(card.ScheduledDays),
		FailCount:    failCount, // Cumulative failure count
		Reps:         reps,      // Total reviews
	}
}

// calculateStabilityFromMastery calculates memory stability from four mastery dimensions.
//
// Design rationale:
// - All four dimensions (listen, read, spell, pronounce) contribute to stability
// - Productive skills (spell, pronounce) weighted 60% as they better indicate memory strength
// - Receptive skills (listen, read) weighted 40%
// - Combined with current interval: high mastery + long interval = high stability
func (a *FSRSAlgorithm) calculateStabilityFromMastery(m entity.MasteryBreakdown, currentInterval int32) float64 {
	// Normalize four dimensions to 0-1
	listen := float64(m.Listen) / 5.0
	read := float64(m.Read) / 5.0
	spell := float64(m.Spell) / 5.0
	pronounce := float64(m.Pronounce) / 5.0

	// Weighted average: receptive 40%, productive 60%
	receptive := (listen + read) / 2.0
	productive := (spell + pronounce) / 2.0
	masteryScore := 0.4*receptive + 0.6*productive // 0-1

	// Calculate base stability from mastery and interval
	// Use square root to amplify low mastery impact
	// Formula: S = mastery^0.5 * interval * 2.0
	baseStability := math.Pow(masteryScore, 0.5) * float64(currentInterval) * 2.0

	// Special handling for new words (interval == 0)
	if currentInterval == 0 {
		// Set initial stability based on mastery level
		switch {
		case masteryScore >= 0.8: // Mastered
			baseStability = 10.0
		case masteryScore >= 0.6: // Proficient
			baseStability = 5.0
		case masteryScore >= 0.4: // Understood
			baseStability = 2.5
		case masteryScore >= 0.2: // Recognized
			baseStability = 1.0
		default: // Unknown
			baseStability = 0.4
		}
	}

	// Clamp to range [0.1, 365 days]
	if baseStability < 0.1 {
		baseStability = 0.1
	}
	if baseStability > 365.0 {
		baseStability = 365.0
	}

	return baseStability
}

// calculateDifficultyFromMastery calculates item difficulty from overall mastery.
//
// Design rationale:
// - Higher mastery_overall means more familiar, thus lower difficulty
// - Inverse linear mapping: overall 0-500 → difficulty 10-1
func (a *FSRSAlgorithm) calculateDifficultyFromMastery(m entity.MasteryBreakdown) float64 {
	// Normalize overall (0-500) to 0-1
	overall := float64(m.Overall) / 500.0

	// Difficulty formula (inverse relationship): D = 10 - (overall * 9)
	// overall = 0   (0%)   → D = 10.0 (hardest)
	// overall = 250 (50%)  → D = 5.5  (medium)
	// overall = 500 (100%) → D = 1.0  (easiest)
	difficulty := 10.0 - (overall * 9.0)

	return difficulty
}

// masteryLevelToFSRSState maps mastery level to FSRS state.
//
// State mapping:
// - New (0): reps == 0
// - Learning (1): low mastery (Unknown/Recognized)
// - Review (2): high mastery (Understood/Proficient/Mastered)
// - Relearning (3): automatically determined by FSRS based on lapses
func (a *FSRSAlgorithm) masteryLevelToFSRSState(level entity.MasteryLevel, reps uint64) fsrs.State {
	// New word
	if reps == 0 {
		return fsrs.New // 0
	}

	// Determine state based on mastery level
	switch level {
	case entity.MasteryLevelUnknown, entity.MasteryLevelRecognized:
		// Low mastery: still learning
		return fsrs.Learning // 1
	case entity.MasteryLevelUnderstood, entity.MasteryLevelProficient, entity.MasteryLevelMastered:
		// High mastery: in review phase
		return fsrs.Review // 2
	default:
		// Unspecified: use reps count to determine
		if reps < 3 {
			return fsrs.Learning
		}
		return fsrs.Review
	}

	// Note: Relearning (3) state is automatically set by FSRS library
	// when a card in Review state fails (lapses increase)
}

// accuracyToRating maps accuracy score (0-1) to FSRS Rating (1-4).
//
// Mapping rules:
// - accuracy < 0.6:  Again (1) - completely forgot
// - 0.6-0.75:        Hard (2)  - barely remembered
// - 0.75-0.95:       Good (3)  - remembered clearly
// - >= 0.95:         Easy (4)  - very easy
func (a *FSRSAlgorithm) accuracyToRating(accuracy float32) fsrs.Rating {
	switch {
	case accuracy < 0.6:
		return fsrs.Again // 1
	case accuracy < 0.75:
		return fsrs.Hard // 2
	case accuracy < 0.95:
		return fsrs.Good // 3
	default:
		return fsrs.Easy // 4
	}
}
