package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
	"github.com/golang/mock/gomock"
	"github.com/stretchr/testify/assert"
)

func TestLearnedWordUsecase_CollectWordByText(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedWordRepository(ctrl)
	mockWordUC := mocks.NewMockWordUsecase(ctrl)

	now := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	uc := &learnedWordUsecase{
		repo:   mockRepo,
		wordUC: mockWordUC,
		clock:  func() time.Time { return now },
	}

	ctx := context.Background()
	userID := int64(1000)

	t.Run("collect new word with sentence", func(t *testing.T) {
		text := "apple"
		sentence := "I ate an apple yesterday."

		// Mock word lookup - word exists in dictionary
		existingWord := &entity.Word{
			ID:       123,
			Lemma:    "apple",
			Language: entity.LanguageEnglish,
		}
		mockWordUC.EXPECT().
			Lookup(ctx, text, entity.LanguageEnglish).
			Return(existingWord, nil)

		// Mock learned word check - not collected yet
		mockRepo.EXPECT().
			FindByWordID(ctx, userID, int64(123)).
			Return(nil, nil)

		// Mock create
		expectedLearnedWord := &entity.LearnedWord{
			WordID:      123,
			UserID:      userID,
			DisplayTerm: text,
			Language:    entity.LanguageEnglish,
			QueryCount:  1,
			CreatedBy:   "user",
			Contexts: []entity.LearnedWordContext{
				{
					Sentence:    sentence,
					Source:      5, // SOURCE_TYPE_MANUAL
					CollectedAt: now,
				},
			},
			Relations: []entity.LearnedWordRelation{},
			Tags:      []string{},
			CreatedAt: now,
			UpdatedAt: now,
		}

		mockRepo.EXPECT().
			Create(ctx, gomock.Any()).
			DoAndReturn(func(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
				// Verify the word structure
				assert.Equal(t, int64(123), word.WordID)
				assert.Equal(t, userID, word.UserID)
				assert.Equal(t, text, word.DisplayTerm)
				assert.Equal(t, entity.LanguageEnglish, word.Language)
				assert.Equal(t, int64(1), word.QueryCount)
				assert.Len(t, word.Contexts, 1)
				assert.Equal(t, sentence, word.Contexts[0].Sentence)
				assert.Equal(t, int32(5), word.Contexts[0].Source)
				return expectedLearnedWord, nil
			})

		result, err := uc.CollectWordByText(ctx, userID, text, entity.LanguageEnglish, sentence)

		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, int64(123), result.WordID)
		assert.Len(t, result.Contexts, 1)
	})

	t.Run("collect word not in dictionary - creates new word", func(t *testing.T) {
		text := "supercalifragilisticexpialidocious"

		// Mock word lookup - word doesn't exist
		mockWordUC.EXPECT().
			Lookup(ctx, text, entity.LanguageEnglish).
			Return(nil, nil)

		// Mock word creation
		newWord := &entity.Word{
			ID:       456,
			Lemma:    text,
			Language: entity.LanguageEnglish,
		}
		mockWordUC.EXPECT().
			Create(ctx, gomock.Any()).
			DoAndReturn(func(ctx context.Context, word *entity.Word) (*entity.Word, error) {
				assert.Equal(t, text, word.Lemma)
				assert.Equal(t, entity.LanguageEnglish, word.Language)
				return newWord, nil
			})

		// Mock learned word check - not collected yet
		mockRepo.EXPECT().
			FindByWordID(ctx, userID, int64(456)).
			Return(nil, nil)

		// Mock create
		mockRepo.EXPECT().
			Create(ctx, gomock.Any()).
			DoAndReturn(func(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
				assert.Equal(t, int64(456), word.WordID)
				assert.Equal(t, text, word.DisplayTerm)
				return word, nil
			})

		result, err := uc.CollectWordByText(ctx, userID, text, entity.LanguageEnglish, "")

		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, int64(456), result.WordID)
	})

	t.Run("re-collect existing word adds new context", func(t *testing.T) {
		text := "run"
		newSentence := "She runs every morning."

		existingWord := &entity.Word{
			ID:       789,
			Lemma:    "run",
			Language: entity.LanguageEnglish,
		}
		mockWordUC.EXPECT().
			Lookup(ctx, text, entity.LanguageEnglish).
			Return(existingWord, nil)

		// Mock existing learned word
		existingLearnedWord := &entity.LearnedWord{
			ID:          1,
			WordID:      789,
			UserID:      userID,
			DisplayTerm: "run",
			Language:    entity.LanguageEnglish,
			Contexts: []entity.LearnedWordContext{
				{
					Sentence: "I ran yesterday.",
					Source:   5,
				},
			},
		}
		mockRepo.EXPECT().
			FindByWordID(ctx, userID, int64(789)).
			Return(existingLearnedWord, nil)

		// Mock update
		mockRepo.EXPECT().
			Update(ctx, gomock.Any()).
			DoAndReturn(func(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
				// Should have merged contexts
				assert.Len(t, word.Contexts, 2)
				assert.Equal(t, "I ran yesterday.", word.Contexts[0].Sentence)
				assert.Equal(t, newSentence, word.Contexts[1].Sentence)
				return word, nil
			})

		result, err := uc.CollectWordByText(ctx, userID, text, entity.LanguageEnglish, newSentence)

		assert.NoError(t, err)
		assert.NotNil(t, result)
		assert.Len(t, result.Contexts, 2)
	})

	t.Run("empty text returns error", func(t *testing.T) {
		result, err := uc.CollectWordByText(ctx, userID, "", entity.LanguageEnglish, "")

		assert.Error(t, err)
		assert.Nil(t, result)
		assert.Equal(t, entity.ErrInvalidLearnedWordText, err)
	})

	t.Run("defaults to English when language unspecified", func(t *testing.T) {
		text := "hello"

		mockWordUC.EXPECT().
			Lookup(ctx, text, entity.LanguageEnglish). // Should use English
			Return(&entity.Word{ID: 111, Lemma: text, Language: entity.LanguageEnglish}, nil)

		mockRepo.EXPECT().
			FindByWordID(ctx, userID, int64(111)).
			Return(nil, nil)

		mockRepo.EXPECT().
			Create(ctx, gomock.Any()).
			DoAndReturn(func(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
				assert.Equal(t, entity.LanguageEnglish, word.Language)
				return word, nil
			})

		result, err := uc.CollectWordByText(ctx, userID, text, entity.LanguageUnspecified, "")

		assert.NoError(t, err)
		assert.NotNil(t, result)
	})
}
