package usecase

import (
	"context"
	"errors"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

type stubLexemeRepo struct {
	created *entity.Lexeme
}

func (s *stubLexemeRepo) Create(_ context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	s.created = lexeme
	return lexeme, nil
}

func (s *stubLexemeRepo) Update(_ context.Context, lexeme *entity.Lexeme) (*entity.Lexeme, error) {
	return lexeme, nil
}

func (s *stubLexemeRepo) GetByID(_ context.Context, lexemeID string) (*entity.Lexeme, error) {
	if lexemeID == "" {
		return nil, entity.ErrLexemeNotFound
	}
	return &entity.Lexeme{ID: lexemeID}, nil
}

func (s *stubLexemeRepo) Lookup(_ context.Context, surface string, _ entity.Language) (*entity.Lexeme, error) {
	if surface == "" {
		return nil, nil
	}
	return &entity.Lexeme{ID: "LX1"}, nil
}

func (s *stubLexemeRepo) List(_ context.Context, _ *repository.ListLexemeQuery) ([]*entity.Lexeme, int64, error) {
	return nil, 0, nil
}

func (s *stubLexemeRepo) ListByWordKey(_ context.Context, _ string) ([]*entity.Lexeme, error) {
	return nil, nil
}

func (s *stubLexemeRepo) ListByIDs(_ context.Context, _ []string) ([]*entity.Lexeme, error) {
	return nil, nil
}

func (s *stubLexemeRepo) Delete(_ context.Context, _ string) error {
	return nil
}

func TestLexemeUsecase_CreateNormalizesData(t *testing.T) {
	repo := &stubLexemeRepo{}
	uc := NewLexemeUsecase(repo, nil)

	payload := &entity.Lexeme{
		Lemma:    "Run",
		Language: entity.LanguageUnspecified,
		Forms: []entity.LexemeForm{
			{Text: "running"},
		},
	}

	created, err := uc.Create(context.Background(), payload)
	if err != nil {
		t.Fatalf("Create returned error: %v", err)
	}

	if created.ID == "" {
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
	uc := NewLexemeUsecase(&stubLexemeRepo{}, nil)
	if _, err := uc.Get(context.Background(), ""); !errors.Is(err, entity.ErrInvalidLexemeID) {
		t.Fatalf("expected ErrInvalidLexemeID, got %v", err)
	}
}
