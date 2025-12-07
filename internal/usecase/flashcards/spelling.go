package flashcards

import (
	"context"
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

var _ Generator = (*SpellingCardGenerator)(nil)

// SpellingCardGenerator generates spelling questions.
type SpellingCardGenerator struct {
	lexemeRepo repository.LexemeRepository
}

func NewSpellingCardGenerator(lexemeRepo repository.LexemeRepository) *SpellingCardGenerator {
	return &SpellingCardGenerator{lexemeRepo: lexemeRepo}
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
			phonetics = form.Phonetics
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
