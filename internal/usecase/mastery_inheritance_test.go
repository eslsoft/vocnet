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
)

func TestLearnedWordUsecase_CollectWord_Inheritance(t *testing.T) {
	userID := uuid.New()
	ctx := context.Background()

	t.Run("auto-creates lemma when collecting inflection", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		repo := mocks.NewMockLearnedWordRepository(ctrl)
		lexemeRepo := mocks.NewMockLexemeRepository(ctrl)
		uc := NewLearnedWordUsecase(repo, lexemeRepo).(*learnedWordUsecase)
		uc.clock = func() time.Time { return time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC) }

		word := &entity.LearnedWord{
			UserID:   userID,
			LexemeID: 100,
			Term:     "running",
			Language: entity.LanguageEnglish,
		}
		word.Mastery.InitializeFromUserMasteryLevel(3)

		lexemeRepo.EXPECT().
			GetByID(ctx, int64(100)).
			Return(&entity.Lexeme{ID: 100, Language: entity.LanguageEnglish, Lemma: "run"}, nil)

		gomock.InOrder(
			repo.EXPECT().
				FindByLexeme(ctx, userID, int64(100), "run").
				Return(nil, nil),
			repo.EXPECT().
				Create(ctx, gomock.Any()).
				DoAndReturn(func(_ context.Context, w *entity.LearnedWord) (*entity.LearnedWord, error) {
					assert.Equal(t, "run", w.Term)
					assert.Equal(t, int32(278), w.Mastery.Overall) // Level 3 normalized
					assert.Equal(t, int64(100), w.LexemeID)
					return w, nil
				}),
			repo.EXPECT().
				FindByLexeme(ctx, userID, int64(100), "running").
				Return(nil, nil),
			repo.EXPECT().
				Create(ctx, gomock.Any()).
				DoAndReturn(func(_ context.Context, w *entity.LearnedWord) (*entity.LearnedWord, error) {
					assert.Equal(t, "running", w.Term)
					assert.Equal(t, int64(100), w.LexemeID)
					return w, nil
				}),
		)

		_, err := uc.CollectWord(ctx, word)
		assert.NoError(t, err)
	})

	t.Run("auto-creates lemma for irregular forms too", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		repo := mocks.NewMockLearnedWordRepository(ctrl)
		lexemeRepo := mocks.NewMockLexemeRepository(ctrl)
		uc := NewLearnedWordUsecase(repo, lexemeRepo).(*learnedWordUsecase)

		word := &entity.LearnedWord{
			UserID:   userID,
			LexemeID: 200,
			Term:     "went",
			Language: entity.LanguageEnglish,
		}

		lexemeRepo.EXPECT().
			GetByID(ctx, int64(200)).
			Return(&entity.Lexeme{ID: 200, Language: entity.LanguageEnglish, Lemma: "go"}, nil)

		gomock.InOrder(
			repo.EXPECT().
				FindByLexeme(ctx, userID, int64(200), "go").
				Return(nil, nil),
			repo.EXPECT().
				Create(ctx, gomock.Any()).
				DoAndReturn(func(_ context.Context, w *entity.LearnedWord) (*entity.LearnedWord, error) {
					assert.Equal(t, "go", w.Term)
					assert.Equal(t, int64(200), w.LexemeID)
					return w, nil
				}),
			repo.EXPECT().
				FindByLexeme(ctx, userID, int64(200), "went").
				Return(nil, nil),
			repo.EXPECT().
				Create(ctx, gomock.Any()).
				DoAndReturn(func(_ context.Context, w *entity.LearnedWord) (*entity.LearnedWord, error) {
					assert.Equal(t, "went", w.Term)
					assert.Equal(t, int64(200), w.LexemeID)
					return w, nil
				}),
		)

		_, err := uc.CollectWord(ctx, word)
		assert.NoError(t, err)
	})
}
