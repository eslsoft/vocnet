package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/golang/mock/gomock"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
	"github.com/eslsoft/vocnet/internal/repository"
)

func TestLearnedWordUsecase_CollectWord_Inheritance(t *testing.T) {
	userID := uuid.New()
	ctx := context.Background()

	t.Run("auto-creates lemma for regular inflection", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		repo := mocks.NewMockLearnedWordRepository(ctrl)
		lexemeRepo := mocks.NewMockLexemeRepository(ctrl)
		uc := NewLearnedWordUsecase(repo, lexemeRepo).(*learnedWordUsecase)
		uc.clock = func() time.Time { return time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC) }

		word := &entity.LearnedWord{
			UserID:   userID,
			Term:     "running",
			Language: entity.LanguageEnglish,
		}
		word.Mastery.InitializeFromUserMasteryLevel(3)

		// Mock lexeme lookup
		lexemeRepo.EXPECT().
			BatchLookupFormInfo(ctx, gomock.Any(), entity.LanguageEnglish).
			Return(map[string][]*repository.LexemeFormInfo{
				"running": {{FormText: "running", FormType: "PRESENT_PARTICIPLE", LemmaText: "run", IsIrregular: false}},
			}, nil)

		// Mock check if lemma exists
		repo.EXPECT().
			FindByTerm(ctx, userID, "run", entity.LanguageEnglish).
			Return(nil, nil)

		// Mock lemma creation
		repo.EXPECT().
			Create(ctx, gomock.Any()).
			DoAndReturn(func(_ context.Context, w *entity.LearnedWord) (*entity.LearnedWord, error) {
				assert.Equal(t, "run", w.Term)
				assert.Equal(t, int32(278), w.Mastery.Overall) // Level 3 normalized
				return w, nil
			})

		// Mock check if original word exists
		repo.EXPECT().
			FindByTerm(ctx, userID, "running", entity.LanguageEnglish).
			Return(nil, nil)

		// Mock original word creation
		repo.EXPECT().
			Create(ctx, gomock.Any()).
			DoAndReturn(func(_ context.Context, w *entity.LearnedWord) (*entity.LearnedWord, error) {
				assert.Equal(t, "running", w.Term)
				return w, nil
			})

		_, err := uc.CollectWord(ctx, word)
		assert.NoError(t, err)
	})

	t.Run("does not create lemma for irregular forms", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		repo := mocks.NewMockLearnedWordRepository(ctrl)
		lexemeRepo := mocks.NewMockLexemeRepository(ctrl)
		uc := NewLearnedWordUsecase(repo, lexemeRepo).(*learnedWordUsecase)

		word := &entity.LearnedWord{
			UserID:   userID,
			Term:     "went",
			Language: entity.LanguageEnglish,
		}

		lexemeRepo.EXPECT().
			BatchLookupFormInfo(ctx, gomock.Any(), entity.LanguageEnglish).
			Return(map[string][]*repository.LexemeFormInfo{
				"went": {{FormText: "went", FormType: "PAST_TENSE", LemmaText: "go", IsIrregular: true}},
			}, nil)

		// FindByTerm for "went"
		repo.EXPECT().
			FindByTerm(ctx, userID, "went", entity.LanguageEnglish).
			Return(nil, nil)

		// Create only "went"
		repo.EXPECT().Create(ctx, gomock.Any()).Return(word, nil)

		_, err := uc.CollectWord(ctx, word)
		assert.NoError(t, err)
	})
}
