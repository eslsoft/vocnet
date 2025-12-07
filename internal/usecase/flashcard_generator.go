package usecase

import (
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/flashcards"
)

// CardGeneratorFactory creates card generators based on card type.
type CardGeneratorFactory struct {
	choice      *flashcards.ChoiceCardGenerator
	spelling    *flashcards.SpellingCardGenerator
	selectWords *flashcards.SelectWordsCardGenerator
}

func NewCardGeneratorFactory(lexemeRepo repository.LexemeRepository) *CardGeneratorFactory {
	return &CardGeneratorFactory{
		choice:      flashcards.NewChoiceCardGenerator(lexemeRepo),
		spelling:    flashcards.NewSpellingCardGenerator(lexemeRepo),
		selectWords: flashcards.NewSelectWordsCardGenerator(lexemeRepo),
	}
}

// GetGenerator returns the appropriate card generator for the given card type.
func (f *CardGeneratorFactory) GetGenerator(cardType entity.CardType) flashcards.Generator {
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
