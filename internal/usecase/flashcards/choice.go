package flashcards

import (
	"context"
	"fmt"
	"math/rand/v2"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

var _ Generator = (*ChoiceCardGenerator)(nil)

// ChoiceCardGenerator generates multiple choice questions.
type ChoiceCardGenerator struct {
	lexemeRepo repository.LexemeRepository
}

func NewChoiceCardGenerator(lexemeRepo repository.LexemeRepository) *ChoiceCardGenerator {
	return &ChoiceCardGenerator{lexemeRepo: lexemeRepo}
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

	// Note: Phonetics extraction removed as Forms are no longer directly accessible from Lexeme
	// Forms are now accessed through Lemma entity. If phonetics are needed, query via LemmaRepository
	phonetics := make([]entity.Phonetic, 0)

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
