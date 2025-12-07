package usecase

import (
	"context"
	"math/rand"
	"sort"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"golang.org/x/exp/slog"
)

// GetFlashCards generates flashcards for a review plan based on user's learning status.
// It implements an 8-step generation process:
// 1. Load ReviewPlan and validate permissions
// 2. Fetch all words associated with the plan
// 3. Classify words (due for review vs new)
// 4. Sort due words by priority (fail_count DESC, overall ASC, next_review_at ASC)
// 5. Select words (prioritize due words, fill with new words)
// 6. Generate cards for each word based on weakest skill
// 7. Shuffle cards
// 8. Return FlashCardSet with statistics
func (u *reviewPlanUsecase) GetFlashCards(ctx context.Context, planID int64, limit int32) (*FlashCardSet, error) {
	userID := auth.MustGetUserID(ctx)

	// Step 1: Load ReviewPlan
	plan, err := u.repo.GetByID(ctx, planID, userID)
	if err != nil {
		return nil, err
	}

	if len(plan.WordbookIDs) == 0 {
		return &FlashCardSet{Cards: []*FlashCard{}, Stats: &FlashCardStats{}}, nil
	}

	// Step 2: Fetch all LearnedWords for this plan
	allWords, err := u.learnedRepo.GetByReviewPlan(ctx, userID, plan.WordbookIDs, false, 0)
	if err != nil {
		return nil, err
	}

	if len(allWords) == 0 {
		return &FlashCardSet{Cards: []*FlashCard{}, Stats: &FlashCardStats{}}, nil
	}

	// Step 3: Classify words
	var dueWords, newWords []*entity.LearnedWord
	now := time.Now()
	// Use day boundaries to bucket today's progress consistently
	endOfDay := entity.EndOfDay(now)

	for _, word := range allWords {
		if isNewWord(word) {
			newWords = append(newWords, word)
		} else if entity.IsReviewDue(word.Review.NextReviewAt, endOfDay) {
			dueWords = append(dueWords, word)
		}
	}

	// Step 4: Sort due words by priority
	sort.Slice(dueWords, func(i, j int) bool {
		// Priority 1: fail_count DESC (more failures = higher priority)
		if dueWords[i].Review.FailCount != dueWords[j].Review.FailCount {
			return dueWords[i].Review.FailCount > dueWords[j].Review.FailCount
		}
		// Priority 2: overall ASC (lower mastery = higher priority)
		if dueWords[i].Mastery.Overall != dueWords[j].Mastery.Overall {
			return dueWords[i].Mastery.Overall < dueWords[j].Mastery.Overall
		}
		// Priority 3: next_review_at ASC (more overdue = higher priority)
		return dueWords[i].Review.NextReviewAt.Before(dueWords[j].Review.NextReviewAt)
	})

	// Step 5: Select words (due words first, then new words)
	selectedWords := make([]*entity.LearnedWord, 0, limit)

	// Take due words up to limit
	for i := 0; i < len(dueWords) && len(selectedWords) < int(limit); i++ {
		selectedWords = append(selectedWords, dueWords[i])
	}

	// Get DailyStats for quota and progress tracking
	var newWordsToday, cardsReviewedToday int32
	if u.dailyStatsRepo != nil {
		ds, err := u.dailyStatsRepo.GetByPlan(ctx, userID, plan.ID, time.Now())
		if err == nil && ds != nil {
			newWordsToday = ds.NewWords
			cardsReviewedToday = ds.CardsReviewed
		}
	}
	// Daily new limit controls how many truly new words can be studied today.
	remainingQuota := int(plan.Config.DailyNewLimit) - int(newWordsToday)
	if remainingQuota < 0 {
		remainingQuota = 0
	}

	// Fill remaining with new words (randomized), but cap by daily new limit
	if len(selectedWords) < int(limit) && len(newWords) > 0 && remainingQuota > 0 {
		rand.Shuffle(len(newWords), func(i, j int) {
			newWords[i], newWords[j] = newWords[j], newWords[i]
		})

		remainingSpace := int(limit) - len(selectedWords)
		countToTake := remainingSpace
		if remainingQuota > 0 && countToTake > remainingQuota {
			countToTake = remainingQuota
		}

		for i := 0; i < len(newWords) && i < countToTake; i++ {
			selectedWords = append(selectedWords, newWords[i])
		}
	}

	// Step 6: Generate cards for each word
	cards := make([]*FlashCard, 0, len(selectedWords))

	for _, word := range selectedWords {
		// Determine card type based on weakest skill
		cardType := selectCardType(word)

		// Generate distractors (random selection from all words)
		distractors := selectDistractors(allWords, word, 3)

		// Generate card
		generator := u.cardFactory.GetGenerator(cardType)
		card, err := generator.Generate(ctx, word, distractors)
		if err != nil {
			// Log error but continue with other cards
			slog.Warn("failed to generate card", "word", word.Term, "error", err)
			continue
		}

		cards = append(cards, card)
	}

	// Step 7: Shuffle cards
	rand.Shuffle(len(cards), func(i, j int) {
		cards[i], cards[j] = cards[j], cards[i]
	})

	// Step 8: Build statistics
	stats := &FlashCardStats{
		NewWords:           int32(remainingQuota), // Remaining new words quota for today
		ReviewWords:        int32(len(selectedWords) - countNewWords(selectedWords)),
		TotalDueWords:      int32(len(dueWords)),
		TodayReviewedCount: cardsReviewedToday, // Cards reviewed today from daily_stats
		EstimatedMinutes:   int32(len(cards) / 4), // Assume ~15 sec per card
	}

	return &FlashCardSet{
		Cards: cards,
		Stats: stats,
	}, nil
}

// SubmitAnswer processes answer results and updates learning progress.
// It implements a 4-step processing flow:
// 1. Verify ReviewPlan exists and belongs to user
// 2. Process each answer result (update mastery, apply algorithm, accumulate stats)
// 3. Update DailyStats atomically
// 4. Return success
func (u *reviewPlanUsecase) SubmitAnswer(ctx context.Context, planID int64, results []*AnswerResult) error {
	userID := auth.MustGetUserID(ctx)

	// Step 1: Verify plan exists and belongs to user
	_, err := u.repo.GetByID(ctx, planID, userID)
	if err != nil {
		return err
	}

	if len(results) == 0 {
		return nil // Nothing to process
	}

	// Step 2: Process each answer result
	now := time.Now()
	todayDate := entity.NormalizeDate(now)

	var totalTimeSpent int32
	var totalScore float32
	newWordsSet := make(map[int64]bool)
	masteredWordsCount := int32(0)

	for _, result := range results {
		// Fetch LearnedWord
		word, err := u.learnedRepo.GetByID(ctx, userID, result.LWordID)
		if err != nil {
			slog.Warn("failed to fetch learned word", "lword_id", result.LWordID, "error", err)
			continue // Skip failed lookups
		}

		// Check if this was a new word (never reviewed before)
		wasNew := isNewWord(word)

		// Map score to mastery dimensions
		mastery := updateMastery(word.Mastery, result.CardType, result.Accuracy)

		// Apply spaced repetition algorithm
		review := u.reviewAlgorithm.CalculateNextReview(word.Review, result.Accuracy)

		// Handle fail penalty (lower mastery if failed 3+ times)
		if review.FailCount >= 3 {
			mastery = applyFailPenalty(mastery)
		}

		// Update LearnedWord in DB
		err = u.learnedRepo.UpdateMasteryAndReview(ctx, word.ID, userID, mastery, review)
		if err != nil {
			slog.Warn("failed to update learned word", "lword_id", word.ID, "error", err)
			continue
		}

		// Accumulate stats
		totalTimeSpent += result.TimeSpentSeconds
		totalScore += result.Accuracy

		// Count new words: words that had no NextReviewAt before this review
		if wasNew {
			newWordsSet[word.ID] = true
		}

		if mastery.Overall >= 400 { // Mastered threshold (overall >= 4.0 * 100)
			masteredWordsCount++
		}
	}

	// Step 3: Update DailyStats (atomic increment)
	if len(results) > 0 {
		avgScore := totalScore / float32(len(results))
		err = u.dailyStatsRepo.IncrementStats(ctx, userID, planID, todayDate,
			int32(len(results)),     // cards_reviewed
			int32(len(newWordsSet)), // new_words
			totalTimeSpent,          // time_spent_seconds
			avgScore,                // score_sum (for average calculation)
			masteredWordsCount,      // words_mastered
		)
		if err != nil {
			// Log error but don't fail the operation
			slog.Error("failed to update daily stats", "error", err)
		}
	}

	// Step 4: Return success
	return nil
}

// Helper functions

// selectCardType determines card type based on weakest mastery dimension.
func selectCardType(word *entity.LearnedWord) CardType {
	mastery := word.Mastery

	// Collect all skills with their scores
	skills := []struct {
		name  string
		score int32
	}{
		{"listen", mastery.Listen},
		{"read", mastery.Read},
		{"spell", mastery.Spell},
		{"pronounce", mastery.Pronounce},
	}

	// Find minimum score
	minScore := skills[0].score
	for _, s := range skills[1:] {
		if s.score < minScore {
			minScore = s.score
		}
	}

	// Collect all skills with minimum score
	weakestSkills := make([]string, 0, len(skills))
	for _, s := range skills {
		if s.score == minScore {
			weakestSkills = append(weakestSkills, s.name)
		}
	}

	// Randomly select one if multiple skills have same minimum score (e.g., all 0 for new words)
	weakestSkill := weakestSkills[rand.Intn(len(weakestSkills))]

	// Map skill to card type
	switch weakestSkill {
	case "listen":
		return CardTypeSPELLING
	case "read":
		return CardTypeCHOICE
	//case "spell":
	//	return CardTypeSELECT_WORDS
	case "pronounce":
		return CardTypeCHOICE // MVP: downgrade to CHOICE
	default:
		return CardTypeCHOICE
	}
}

// selectDistractors randomly selects N distractors excluding the target word.
func selectDistractors(allWords []*entity.LearnedWord, target *entity.LearnedWord, count int) []*entity.LearnedWord {
	candidates := make([]*entity.LearnedWord, 0, len(allWords))
	for _, w := range allWords {
		if w.ID != target.ID {
			candidates = append(candidates, w)
		}
	}

	rand.Shuffle(len(candidates), func(i, j int) {
		candidates[i], candidates[j] = candidates[j], candidates[i]
	})

	if len(candidates) < count {
		return candidates
	}
	return candidates[:count]
}

// countNewWords counts words with overall mastery == 0.
func countNewWords(words []*entity.LearnedWord) int {
	count := 0
	for _, w := range words {
		if isNewWord(w) {
			count++
		}
	}
	return count
}

// isNewWord treats words with no scheduled review as "new" (pre-study).
func isNewWord(word *entity.LearnedWord) bool {
	if word == nil {
		return true
	}
	return word.Review.NextReviewAt.IsZero()
}

// updateMastery applies score to relevant mastery dimensions based on card type.
func updateMastery(current entity.MasteryBreakdown, cardType CardType, score float32) entity.MasteryBreakdown {
	// Score delta: map 0.0-1.0 score to -1 to +1 mastery change
	delta := (score - 0.5) * 2.0 // 0.0→-1.0, 0.5→0.0, 1.0→+1.0

	updated := current

	switch cardType {
	case CardTypeCHOICE:
		// Affects: reading
		updated.Read = clampMastery(updated.Read + int32(delta))

	case CardTypeSPELLING:
		// Affects: listening (60%), spelling (40%)
		updated.Listen = clampMastery(updated.Listen + int32(delta*0.6))
		updated.Spell = clampMastery(updated.Spell + int32(delta*0.4))

	case CardTypeSELECT_WORDS:
		// Affects: reading (50%), spelling (50%)
		updated.Read = clampMastery(updated.Read + int32(delta*0.5))
		updated.Spell = clampMastery(updated.Spell + int32(delta*0.5))
	}

	// Recalculate overall
	updated.Overall = (updated.Listen + updated.Read + updated.Spell + updated.Pronounce) * 25

	return updated
}

// applyFailPenalty reduces all mastery dimensions by 1.
func applyFailPenalty(mastery entity.MasteryBreakdown) entity.MasteryBreakdown {
	return entity.MasteryBreakdown{
		Listen:    clampMastery(mastery.Listen - 1),
		Read:      clampMastery(mastery.Read - 1),
		Spell:     clampMastery(mastery.Spell - 1),
		Pronounce: clampMastery(mastery.Pronounce - 1),
		Overall:   clampMastery32(mastery.Overall - 25), // Decrease by 0.25 * 100
	}
}

// clampMastery limits mastery value to [0, 5] range.
func clampMastery(val int32) int32 {
	if val < 0 {
		return 0
	}
	if val > 5 {
		return 5
	}
	return val
}

// clampMastery32 limits overall mastery value to [0, 500] range.
func clampMastery32(val int32) int32 {
	if val < 0 {
		return 0
	}
	if val > 500 {
		return 500
	}
	return val
}
