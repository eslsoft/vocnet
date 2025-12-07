package flashcards

import (
	"context"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/google/uuid"
)

// CardGenerator defines the interface for card type generators.
type Generator interface {
	Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*entity.FlashCard, error)
}

// Helper functions

func generateCardID() string {
	return uuid.New().String()
}

func calculateDifficulty(masteryScore int32) int32 {
	// Convert mastery (0-5) to difficulty (1-5)
	// Lower mastery = higher difficulty
	if masteryScore == 0 {
		return 3 // Default difficulty for new words
	}
	return 6 - masteryScore // 5→1, 4→2, 3→3, 2→4, 1→5
}

// getPreferredGloss returns glosses from senses, preferring Chinese if available.
// Multiple glosses are joined with "；".
func getPreferredGloss(senses []entity.LexemeSense) string {
	if len(senses) == 0 {
		return ""
	}

	// Collect Chinese glosses first
	var chineseGlosses []string
	for _, sense := range senses {
		if sense.Language == entity.LanguageChinese && strings.TrimSpace(sense.Gloss) != "" {
			chineseGlosses = append(chineseGlosses, strings.TrimSpace(sense.Gloss))
		}
	}

	if len(chineseGlosses) > 0 {
		return strings.Join(chineseGlosses, "；")
	}

	// Fallback to English or any available glosses
	var englishGlosses []string
	for _, sense := range senses {
		if sense.Language == entity.LanguageEnglish && strings.TrimSpace(sense.Gloss) != "" {
			englishGlosses = append(englishGlosses, strings.TrimSpace(sense.Gloss))
		}
	}

	if len(englishGlosses) > 0 {
		return strings.Join(englishGlosses, "; ")
	}

	// Last resort: return any available gloss
	for _, sense := range senses {
		if gloss := strings.TrimSpace(sense.Gloss); gloss != "" {
			return gloss
		}
	}

	return ""
}
