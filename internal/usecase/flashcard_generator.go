package usecase

import (
	"context"
	"fmt"
	"math/rand"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/google/uuid"
)

// CardGenerator defines the interface for card type generators.
type CardGenerator interface {
	Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*entity.FlashCard, error)
}

// CardGeneratorFactory creates card generators based on card type.
type CardGeneratorFactory struct {
	choice      CardGenerator
	spelling    CardGenerator
	selectWords CardGenerator
}

// NewCardGeneratorFactory creates a new card generator factory.
func NewCardGeneratorFactory(lexemeRepo repository.LexemeRepository) *CardGeneratorFactory {
	return &CardGeneratorFactory{
		choice:      &ChoiceCardGenerator{lexemeRepo: lexemeRepo},
		spelling:    &SpellingCardGenerator{lexemeRepo: lexemeRepo},
		selectWords: &SelectWordsCardGenerator{lexemeRepo: lexemeRepo},
	}
}

// GetGenerator returns the appropriate card generator for the given card type.
func (f *CardGeneratorFactory) GetGenerator(cardType entity.CardType) CardGenerator {
	switch cardType {
	case entity.CardTypeCHOICE:
		return f.choice
	case entity.CardTypeSPELLING:
		return f.spelling
	case entity.CardTypeSELECT_WORDS:
		return f.selectWords
	default:
		return f.choice
	}
}

// ChoiceCardGenerator generates multiple choice questions.
type ChoiceCardGenerator struct {
	lexemeRepo repository.LexemeRepository
}

// Generate creates a CHOICE type flashcard.
func (g *ChoiceCardGenerator) Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*entity.FlashCard, error) {
	// Fetch word definition from Lexeme table
	lexeme, err := g.lexemeRepo.Lookup(ctx, word.Term, word.Language)
	if err != nil || lexeme == nil || len(lexeme.Senses) == 0 {
		return nil, fmt.Errorf("no definition found for word: %s", word.Term)
	}

	// Select preferred glosses (Chinese if available, otherwise English)
	correctGloss := getPreferredGloss(lexeme.Senses)
	if correctGloss == "" {
		return nil, fmt.Errorf("no valid gloss found for word: %s", word.Term)
	}

	// Generate options (without IDs first)
	// Use index 0 to mark the correct answer
	options := []*entity.CardItem{
		{Text: correctGloss},
	}

	// Add distractor glosses
	for i, dist := range distractors {
		if i >= 3 {
			break
		}
		distLexeme, _ := g.lexemeRepo.Lookup(ctx, dist.Term, dist.Language)
		if distLexeme != nil && len(distLexeme.Senses) > 0 {
			if distGloss := getPreferredGloss(distLexeme.Senses); distGloss != "" {
				options = append(options, &entity.CardItem{Text: distGloss})
			}
		}
	}

	// Remember which index is the correct answer before shuffling
	correctIndex := 0

	// Shuffle options with index tracking
	indices := make([]int, len(options))
	for i := range indices {
		indices[i] = i
	}
	rand.Shuffle(len(options), func(i, j int) {
		options[i], options[j] = options[j], options[i]
		indices[i], indices[j] = indices[j], indices[i]
	})

	// Find where the correct answer ended up after shuffle
	var correctID string
	optionLabels := []string{"A", "B", "C", "D"}
	for i, idx := range indices {
		options[i].ID = optionLabels[i]
		if idx == correctIndex {
			correctID = optionLabels[i]
		}
	}

	// Extract phonetics from forms (typically the lemma form)
	phonetics := make([]entity.Phonetic, 0)
	for _, form := range lexeme.Forms {
		if form.FormType == entity.LexemeFormTypeLemma {
			for _, p := range form.Phonetics {
				phonetics = append(phonetics, p)
			}
			break
		}
	}

	return &entity.FlashCard{
		ID:      generateCardID(),
		Type:    entity.CardTypeCHOICE,
		LWordID: word.ID,
		Prompt:  "选择正确的释义",
		Question: &entity.CardQuestion{
			Text:      word.Term,
			AutoPlay:  true,
			Phonetics: phonetics,
		},
		Options: options,
		Answer: &entity.CardAnswer{
			CorrectValues: []string{correctID},
		},
		Difficulty: calculateDifficulty(word.Mastery.Read),
	}, nil
}

// SpellingCardGenerator generates spelling questions.
type SpellingCardGenerator struct {
	lexemeRepo repository.LexemeRepository
}

// Generate creates a SPELLING type flashcard.
func (g *SpellingCardGenerator) Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*entity.FlashCard, error) {
	// Fetch word definition from Lexeme table to get phonetics
	lexeme, err := g.lexemeRepo.Lookup(ctx, word.Term, word.Language)
	if err != nil || lexeme == nil {
		return nil, fmt.Errorf("no lexeme found for word: %s", word.Term)
	}

	// Extract phonetics from forms (typically the lemma form)
	phonetics := make([]entity.Phonetic, 0)
	for _, form := range lexeme.Forms {
		if form.FormType == entity.LexemeFormTypeLemma {
			for _, p := range form.Phonetics {
				phonetics = append(phonetics, p)
			}
			break
		}
	}

	return &entity.FlashCard{
		ID:      generateCardID(),
		Type:    entity.CardTypeSPELLING,
		LWordID: word.ID,
		Prompt:  "听音频，拼写出你听到的单词",
		Question: &entity.CardQuestion{
			Text:      word.Term, // Used for TTS, not shown to user
			AutoPlay:  true,
			Phonetics: phonetics,
		},
		Options: []*entity.CardItem{
			{ID: "hint1", Hint: fmt.Sprintf("%d letters", len(word.Term))},
		},
		Answer: &entity.CardAnswer{
			CorrectValues: []string{word.Term},
			Config: &entity.AnswerConfig{
				IgnoreCase: true,
			},
		},
		Difficulty: calculateDifficulty(word.Mastery.Spell),
	}, nil
}

// SelectWordsCardGenerator generates fill-in-the-blank questions.
type SelectWordsCardGenerator struct {
	lexemeRepo repository.LexemeRepository
}

// Generate creates a SELECT_WORDS type flashcard.
func (g *SelectWordsCardGenerator) Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*entity.FlashCard, error) {
	// Select example sentence (priority: LearnedWord.Contexts > Lexeme.Senses)
	var exampleSentence string
	if len(word.Contexts) > 0 {
		exampleSentence = word.Contexts[0].Sentence
	} else {
		lexeme, err := g.lexemeRepo.Lookup(ctx, word.Term, word.Language)
		if err == nil && lexeme != nil && len(lexeme.Senses) > 0 {
			for _, sense := range lexeme.Senses {
				if len(sense.Examples) > 0 && sense.Examples[0].Text != "" {
					exampleSentence = sense.Examples[0].Text
					break
				}
			}
		}
	}

	if exampleSentence == "" {
		return nil, fmt.Errorf("no example sentence available for word: %s", word.Term)
	}

	// Replace target word with blank (case-insensitive)
	questionText := strings.ReplaceAll(
		strings.ToLower(exampleSentence),
		strings.ToLower(word.Term),
		"___",
	)

	// If no replacement happened, try to find the word with different capitalization
	if questionText == strings.ToLower(exampleSentence) {
		// Try exact match
		questionText = strings.ReplaceAll(exampleSentence, word.Term, "___")
	}

	// Generate options (correct word + distractors)
	options := []*entity.CardItem{
		{ID: "opt1", Text: word.Term},
	}

	for i, dist := range distractors {
		if i >= 3 {
			break
		}
		options = append(options, &entity.CardItem{
			ID:   fmt.Sprintf("opt%d", i+2),
			Text: dist.Term,
		})
	}

	// Shuffle options
	rand.Shuffle(len(options), func(i, j int) {
		options[i], options[j] = options[j], options[i]
	})

	// Find correct option ID after shuffle
	var correctID string
	for _, opt := range options {
		if opt.Text == word.Term {
			correctID = opt.ID
			break
		}
	}

	return &entity.FlashCard{
		ID:      generateCardID(),
		Type:    entity.CardTypeSELECT_WORDS,
		LWordID: word.ID,
		Prompt:  "选择正确的单词填空",
		Question: &entity.CardQuestion{
			Text: questionText,
		},
		Options: options,
		Answer: &entity.CardAnswer{
			CorrectValues: []string{fmt.Sprintf("blank1:%s", correctID)},
		},
		Difficulty: calculateDifficulty((word.Mastery.Read + word.Mastery.Spell) / 2),
	}, nil
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
