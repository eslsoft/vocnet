package flashcards

import (
	"context"
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

var _ Generator = (*SelectWordsCardGenerator)(nil)

// SelectWordsCardGenerator generates fill-in-the-blank questions.
type SelectWordsCardGenerator struct {
	lexemeRepo repository.LexemeRepository
}

func NewSelectWordsCardGenerator(lexemeRepo repository.LexemeRepository) *SelectWordsCardGenerator {
	return &SelectWordsCardGenerator{lexemeRepo: lexemeRepo}
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
