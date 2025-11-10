package usecase

import (
	"context"
	"errors"
	"testing"

	"github.com/golang/mock/gomock"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/mocks"
)

func TestLexemeUsecase_CreateNormalizesData(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLexemeUsecase(mockRepo, nil)

	payload := &entity.Lexeme{
		ExternalID: "L999",
		Lemma:      "Run",
		Language:   entity.LanguageUnspecified,
		Forms: []entity.LexemeForm{
			{Text: "running"},
		},
	}

	// Setup expectation: the repository should receive normalized data
	mockRepo.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
			// Simulate ID generation
			lexeme.ID = 123
			// Verify normalization before repository call
			if lexeme.Language != entity.LanguageEnglish {
				t.Errorf("expected default language to be English, got %s", lexeme.Language)
			}
			// Forms are normalized AFTER repository call in the usecase
			// so at this point they won't have the lexeme ID yet
			return lexeme, nil
		})

	created, err := uc.Create(context.Background(), payload)
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}

	if created.ID == 0 {
		t.Fatalf("expected generated lexeme ID")
	}
	if created.Language != entity.LanguageEnglish {
		t.Fatalf("expected default language, got %s", created.Language)
	}
	// After Create returns, forms should have the lexeme ID
	if len(created.Forms) == 0 || created.Forms[0].LexemeID != created.ID {
		t.Fatalf("expected forms to inherit lexeme ID, got LexemeID=%d", created.Forms[0].LexemeID)
	}
}

func TestLexemeUsecase_GetValidatesIdentifier(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mockRepo := mocks.NewMockLexemeRepository(ctrl)
	uc := NewLexemeUsecase(mockRepo, nil)

	if _, err := uc.Get(context.Background(), 0); !errors.Is(err, entity.ErrInvalidLexemeID) {
		t.Fatalf("expected ErrInvalidLexemeID, got %v", err)
	}
}
