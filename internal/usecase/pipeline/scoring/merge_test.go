package scoring

import (
	"log/slog"
	"os"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEvaluateAndMergeLexemes_UnifiedMatching(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	scorer := NewRuleBasedScorer()
	evaluator := NewDataEvaluator(scorer, logger)

	t.Run("ExternalID_matching_preserves_existing_logic", func(t *testing.T) {
		// Existing Wikidata lexeme with ExternalID
		existing := []*entity.Lexeme{
			{
				ExternalID:   "L12345",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "greeting"},
				},
			},
		}

		// New Wikidata lexeme with same ExternalID
		new := []*entity.Lexeme{
			{
				ExternalID:   "L12345",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "salutation"},
				},
			},
		}

		result, decisions := evaluator.EvaluateAndMergeLexemes(existing, new, "wikidata")

		// Should have 1 merged lexeme, not 2 separate ones
		assert.Len(t, result, 1)
		assert.Len(t, result[0].Senses, 2) // Both senses merged
		assert.Len(t, decisions, 1)
		assert.Contains(t, decisions[0].Reason, "external_id")
	})

	t.Run("POS_matching_merges_ECDICT_with_Wikidata", func(t *testing.T) {
		// Existing Wikidata lexeme with ExternalID
		existing := []*entity.Lexeme{
			{
				ExternalID:   "L12345",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "greeting"},
				},
			},
		}

		// New ECDICT lexeme without ExternalID, same POS
		new := []*entity.Lexeme{
			{
				ExternalID:   "", // ECDICT has no ExternalID
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageChinese, Gloss: "问候"},
				},
			},
		}

		result, decisions := evaluator.EvaluateAndMergeLexemes(existing, new, "ecdict")

		// Should have 1 merged lexeme with both English and Chinese senses
		require.Len(t, result, 1)
		assert.Len(t, result[0].Senses, 2)

		// Check both senses are present
		englishSense := findSenseByLanguage(result[0].Senses, entity.LanguageEnglish)
		chineseSense := findSenseByLanguage(result[0].Senses, entity.LanguageChinese)
		assert.NotNil(t, englishSense, "English sense should be preserved")
		assert.NotNil(t, chineseSense, "Chinese sense should be added")
		assert.Equal(t, "greeting", englishSense.Gloss)
		assert.Equal(t, "问候", chineseSense.Gloss)

		assert.Len(t, decisions, 1)
		assert.Contains(t, decisions[0].Reason, "language_pos")
	})

	t.Run("POS_matching_only_for_same_POS", func(t *testing.T) {
		// Existing lexeme: noun
		existing := []*entity.Lexeme{
			{
				ExternalID:   "",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "greeting noun"},
				},
			},
		}

		// New lexeme: verb (different POS)
		new := []*entity.Lexeme{
			{
				ExternalID:   "",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechVerb,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageChinese, Gloss: "打招呼动词"},
				},
			},
		}

		result, decisions := evaluator.EvaluateAndMergeLexemes(existing, new, "ecdict")

		// Should have 2 separate lexemes (different POS)
		assert.Len(t, result, 2)
		assert.Equal(t, entity.PartOfSpeechNoun, result[0].PartOfSpeech)
		assert.Equal(t, entity.PartOfSpeechVerb, result[1].PartOfSpeech)

		assert.Len(t, decisions, 1)
		assert.Equal(t, "new lexeme - no conflict", decisions[0].Reason)
	})

	t.Run("ExternalID_takes_precedence_over_POS", func(t *testing.T) {
		// Existing: both ExternalID and no ExternalID lexemes
		existing := []*entity.Lexeme{
			{
				ExternalID:   "L12345",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "wikidata sense"},
				},
			},
			{
				ExternalID:   "",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageChinese, Gloss: "ecdict sense"},
				},
			},
		}

		// New: same ExternalID as first lexeme
		new := []*entity.Lexeme{
			{
				ExternalID:   "L12345",
				Language:     entity.LanguageEnglish,
				PartOfSpeech: entity.PartOfSpeechNoun,
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "new wikidata sense"},
				},
			},
		}

		result, decisions := evaluator.EvaluateAndMergeLexemes(existing, new, "wikidata")

		// Should match by ExternalID (first lexeme), not POS (second lexeme)
		assert.Len(t, result, 2)
		assert.Len(t, result[0].Senses, 2) // First lexeme got the new sense
		assert.Len(t, result[1].Senses, 1) // Second lexeme unchanged

		assert.Len(t, decisions, 1)
		assert.Contains(t, decisions[0].Reason, "external_id")
	})
}

// Helper function to find a sense by language
func findSenseByLanguage(senses []entity.LexemeSense, lang entity.Language) *entity.LexemeSense {
	for _, sense := range senses {
		if sense.Language == lang {
			return &sense
		}
	}
	return nil
}
