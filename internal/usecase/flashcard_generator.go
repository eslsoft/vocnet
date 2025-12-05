package usecase

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/google/uuid"
)

// CardType represents the type of flashcard.
type CardType string

const (
	CardTypeCHOICE       CardType = "CHOICE"
	CardTypeSPELLING     CardType = "SPELLING"
	CardTypeSELECT_WORDS CardType = "SELECT_WORDS"
)

// FlashCard represents a single flashcard for vocabulary review.
type FlashCard struct {
	ID          string
	Type        CardType
	LWordID     int64
	Prompt      string
	Question    *CardQuestion
	Options     []*CardItem
	Answer      *CardAnswer
	Difficulty  int32
	Annotations map[string]string
}

// CardQuestion represents the question content of a flashcard.
type CardQuestion struct {
	Text      string
	AutoPlay  bool
	Phonetics []Phonetic
	ImageURL  string
}

// Phonetic represents pronunciation information.
type Phonetic struct {
	Accent string // e.g., "US", "UK"
	Text   string // e.g., "/ˈæpl/"
}

// CardItem represents an option or interactive item in a flashcard.
type CardItem struct {
	ID    string
	Text  string
	Hint  string
	Group string // For matching questions
}

// CardAnswer represents the correct answer and validation rules.
type CardAnswer struct {
	CorrectValues []string
	Config        *AnswerConfig
}

// AnswerConfig contains validation configuration.
type AnswerConfig struct {
	IgnoreCase bool
}

// FlashCardSet represents a collection of flashcards with statistics.
type FlashCardSet struct {
	Cards []*FlashCard
	Stats *FlashCardStats
}

// FlashCardStats contains statistics about the flashcard set.
type FlashCardStats struct {
	NewWords           int32
	ReviewWords        int32
	TotalDueWords      int32
	EstimatedMinutes   int32
	TodayReviewedCount int32
}

// AnswerResult represents the result of answering a flashcard.
type AnswerResult struct {
	LWordID          int64
	CardType         CardType
	Correct          bool
	Accuracy         float32
	TimeSpentSeconds int32
	AnsweredAt       time.Time
}

// CardGenerator defines the interface for card type generators.
type CardGenerator interface {
	Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*FlashCard, error)
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
		spelling:    &SpellingCardGenerator{},
		selectWords: &SelectWordsCardGenerator{lexemeRepo: lexemeRepo},
	}
}

// GetGenerator returns the appropriate card generator for the given card type.
func (f *CardGeneratorFactory) GetGenerator(cardType CardType) CardGenerator {
	switch cardType {
	case CardTypeCHOICE:
		return f.choice
	case CardTypeSPELLING:
		return f.spelling
	case CardTypeSELECT_WORDS:
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
func (g *ChoiceCardGenerator) Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*FlashCard, error) {
	// Fetch word definition from Lexeme table
	lexeme, err := g.lexemeRepo.Lookup(ctx, word.Term, word.Language)
	if err != nil || lexeme == nil || len(lexeme.Senses) == 0 {
		return nil, fmt.Errorf("no definition found for word: %s", word.Term)
	}

	// Select primary sense gloss as correct answer
	correctGloss := lexeme.Senses[0].Gloss

	// Generate options
	options := []*CardItem{
		{ID: "A", Text: correctGloss},
	}

	// Add distractor glosses
	optionLabels := []string{"B", "C", "D"}
	for i, dist := range distractors {
		if i >= 3 {
			break
		}
		distLexeme, _ := g.lexemeRepo.Lookup(ctx, dist.Term, dist.Language)
		if distLexeme != nil && len(distLexeme.Senses) > 0 {
			options = append(options, &CardItem{
				ID:   optionLabels[i],
				Text: distLexeme.Senses[0].Gloss,
			})
		}
	}

	// Shuffle options
	rand.Shuffle(len(options), func(i, j int) {
		options[i], options[j] = options[j], options[i]
	})

	// Find correct answer ID after shuffle
	var correctID string
	for _, opt := range options {
		if opt.Text == correctGloss {
			correctID = opt.ID
			break
		}
	}

	// Extract phonetics from forms (typically the lemma form)
	phonetics := make([]Phonetic, 0)
	for _, form := range lexeme.Forms {
		if form.FormType == entity.LexemeFormTypeLemma {
			for _, p := range form.Phonetics {
				phonetics = append(phonetics, Phonetic{
					Accent: p.Dialect,
					Text:   p.IPA,
				})
			}
			break
		}
	}

	return &FlashCard{
		ID:      generateCardID(),
		Type:    CardTypeCHOICE,
		LWordID: word.ID,
		Prompt:  "选择正确的释义",
		Question: &CardQuestion{
			Text:      word.Term,
			AutoPlay:  true,
			Phonetics: phonetics,
		},
		Options: options,
		Answer: &CardAnswer{
			CorrectValues: []string{correctID},
		},
		Difficulty: calculateDifficulty(word.Mastery.Read),
	}, nil
}

// SpellingCardGenerator generates spelling questions.
type SpellingCardGenerator struct{}

// Generate creates a SPELLING type flashcard.
func (g *SpellingCardGenerator) Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*FlashCard, error) {
	return &FlashCard{
		ID:      generateCardID(),
		Type:    CardTypeSPELLING,
		LWordID: word.ID,
		Prompt:  "听音频，拼写出你听到的单词",
		Question: &CardQuestion{
			Text:     word.Term, // Used for TTS, not shown to user
			AutoPlay: true,
		},
		Options: []*CardItem{
			{ID: "hint1", Hint: fmt.Sprintf("%d letters", len(word.Term))},
		},
		Answer: &CardAnswer{
			CorrectValues: []string{word.Term},
			Config: &AnswerConfig{
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
func (g *SelectWordsCardGenerator) Generate(ctx context.Context, word *entity.LearnedWord, distractors []*entity.LearnedWord) (*FlashCard, error) {
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
	options := []*CardItem{
		{ID: "opt1", Text: word.Term},
	}

	for i, dist := range distractors {
		if i >= 3 {
			break
		}
		options = append(options, &CardItem{
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

	return &FlashCard{
		ID:      generateCardID(),
		Type:    CardTypeSELECT_WORDS,
		LWordID: word.ID,
		Prompt:  "选择正确的单词填空",
		Question: &CardQuestion{
			Text: questionText,
		},
		Options: options,
		Answer: &CardAnswer{
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
