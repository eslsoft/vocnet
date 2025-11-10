package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/golang/mock/gomock"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
)

func TestCollectLexemeCreatesAndUpdates(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedLexemeRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedLexemeUsecase(mockRepo, mockLexemeRepo)

	payload := &entity.LearnedLexeme{
		LexemeID:    1,
		DisplayTerm: "Test",
		Language:    entity.LanguageEnglish,
		CreatedBy:   "user",
	}

	// First call: create new entry
	mockRepo.EXPECT().
		FindByLexemeID(gomock.Any(), int64(1), int64(1)).
		Return(nil, nil)

	mockLexemeRepo.EXPECT().
		GetByID(gomock.Any(), int64(1)).
		Return(&entity.Lexeme{ID: 1, ExternalID: "L1"}, nil)

	mockRepo.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
			if lexeme.QueryCount != 1 {
				t.Errorf("expected query count=1, got %d", lexeme.QueryCount)
			}
			if lexeme.LexemeExternalID != "L1" {
				t.Errorf("expected ExternalID to be copied from lexeme")
			}
			copy := *lexeme
			return &copy, nil
		})

	got, err := uc.CollectLexeme(context.Background(), 1, payload)
	if err != nil {
		t.Fatalf("CollectLexeme create returned error: %v", err)
	}
	if got.QueryCount != 1 {
		t.Fatalf("expected query count=1, got %d", got.QueryCount)
	}

	// Second call: update existing entry
	existing := &entity.LearnedLexeme{
		UserID:      1,
		LexemeID:    1,
		DisplayTerm: "Test",
		Language:    entity.LanguageEnglish,
		CreatedBy:   "user",
		QueryCount:  1,
	}

	payload.Note = "updated"
	payload.QueryCount = 5 // should be ignored, incremented from existing

	mockRepo.EXPECT().
		FindByLexemeID(gomock.Any(), int64(1), int64(1)).
		Return(existing, nil)

	mockRepo.EXPECT().
		Update(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
			if lexeme.Note != "updated" {
				t.Errorf("expected note propagated, got %q", lexeme.Note)
			}
			if lexeme.QueryCount != 2 {
				t.Errorf("expected query count increment, got %d", lexeme.QueryCount)
			}
			copy := *lexeme
			return &copy, nil
		})

	got, err = uc.CollectLexeme(context.Background(), 1, payload)
	if err != nil {
		t.Fatalf("CollectLexeme update returned error: %v", err)
	}
	if got.Note != "updated" {
		t.Fatalf("expected note propagated, got %q", got.Note)
	}
	if got.QueryCount != 2 {
		t.Fatalf("expected query count increment, got %d", got.QueryCount)
	}
}

func TestUpdateMasteryUsesLexemeID(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLearnedLexemeRepository(ctrl)
	mockLexemeRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLearnedLexemeUsecase(mockRepo, mockLexemeRepo)

	entry := &entity.LearnedLexeme{
		UserID:    2,
		LexemeID:  42,
		CreatedBy: "user",
	}
	entry.Normalize(time.Now())

	mockRepo.EXPECT().
		GetByLexemeID(gomock.Any(), int64(2), int64(42)).
		Return(entry, nil)

	mockRepo.EXPECT().
		Update(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
			if lexeme.Mastery.Overall != 10 || lexeme.Note != "note" {
				t.Errorf("update did not receive changes")
			}
			copy := *lexeme
			return &copy, nil
		})

	result, err := uc.UpdateMastery(context.Background(), 2, 42, entity.MasteryBreakdown{Overall: 10}, entity.ReviewTiming{IntervalDays: 3}, map[string]entity.FormMastery{
		"form": {FormID: "form", Strength: 1},
	}, "note")
	if err != nil {
		t.Fatalf("UpdateMastery failed: %v", err)
	}
	if result.Mastery.Overall != 10 || result.Note != "note" {
		t.Fatalf("update did not persist changes")
	}
}
