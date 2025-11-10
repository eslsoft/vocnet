package usecase

import (
	"context"
	"errors"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

type testLexemeRepo struct {
	created *entity.Lexeme
}

func (s *testLexemeRepo) Create(_ context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	// Simulate ID generation
	if lexeme.ID == 0 {
		lexeme.ID = 123
	}
	s.created = lexeme
	return lexeme, nil
}

func (s *testLexemeRepo) Update(_ context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	return lexeme, nil
}

func (s *testLexemeRepo) GetByID(_ context.Context, lexemeID int64) (*entity.Lexeme, error) {
	if lexemeID == 0 {
		return nil, entity.ErrLexemeNotFound
	}
	return &entity.Lexeme{ID: lexemeID}, nil
}

func (s *testLexemeRepo) Lookup(_ context.Context, surface string, _ entity.Language) (*entity.Lexeme, error) {
	if surface == "" {
		return nil, nil
	}
	return &entity.Lexeme{ID: 1}, nil
}

func (s *testLexemeRepo) List(_ context.Context, _ *repository.ListLexemeQuery) ([]*entity.Lexeme, int64, error) {
	return nil, 0, nil
}

func (s *testLexemeRepo) ListByWordID(_ context.Context, _ int64) ([]*entity.Lexeme, error) {
	return nil, nil
}

func (s *testLexemeRepo) ListByIDs(_ context.Context, _ []int64) ([]*entity.Lexeme, error) {
	return nil, nil
}

func (s *testLexemeRepo) Delete(_ context.Context, _ int64) error {
	return nil
}

func TestLexemeUsecase_CreateNormalizesData(t *testing.T) {
	repo := &testLexemeRepo{}
	uc := NewLexemeUsecase(repo, nil)

	payload := &entity.Lexeme{
		ExternalID: "L999",
		Lemma:      "Run",
		Language:   entity.LanguageUnspecified,
		Forms: []entity.LexemeForm{
			{Text: "running"},
		},
	}

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
	if repo.created == nil || repo.created.Forms[0].LexemeID != created.ID {
		t.Fatalf("expected forms to inherit lexeme ID")
	}
}

func TestLexemeUsecase_GetValidatesIdentifier(t *testing.T) {
	uc := NewLexemeUsecase(&testLexemeRepo{}, nil)
	if _, err := uc.Get(context.Background(), 0); !errors.Is(err, entity.ErrInvalidLexemeID) {
		t.Fatalf("expected ErrInvalidLexemeID, got %v", err)
	}
}
