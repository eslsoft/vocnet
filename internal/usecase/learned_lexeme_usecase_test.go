package usecase

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

type inMemoryLearnedRepo struct {
	store map[string]*entity.LearnedLexeme
}

func newInMemoryLearnedRepo() *inMemoryLearnedRepo {
	return &inMemoryLearnedRepo{store: map[string]*entity.LearnedLexeme{}}
}

func (r *inMemoryLearnedRepo) Create(_ context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	copy := *lexeme
	r.store[key(lexeme)] = &copy
	return &copy, nil
}

func (r *inMemoryLearnedRepo) Update(_ context.Context, lexeme *entity.LearnedLexeme) (*entity.LearnedLexeme, error) {
	if _, ok := r.store[key(lexeme)]; !ok {
		return nil, entity.ErrLearnedLexemeNotFound
	}
	copy := *lexeme
	r.store[key(lexeme)] = &copy
	return &copy, nil
}

func (r *inMemoryLearnedRepo) GetByLexemeID(_ context.Context, userID int64, lexemeID string) (*entity.LearnedLexeme, error) {
	rec, ok := r.store[userKey(userID, lexemeID)]
	if !ok {
		return nil, entity.ErrLearnedLexemeNotFound
	}
	copy := *rec
	return &copy, nil
}

func (r *inMemoryLearnedRepo) FindByLexemeID(_ context.Context, userID int64, lexemeID string) (*entity.LearnedLexeme, error) {
	rec, ok := r.store[userKey(userID, lexemeID)]
	if !ok {
		return nil, nil
	}
	copy := *rec
	return &copy, nil
}

func (r *inMemoryLearnedRepo) List(context.Context, *repository.ListLearnedLexemeQuery) ([]entity.LearnedLexeme, int64, error) {
	return nil, 0, nil
}

func (r *inMemoryLearnedRepo) DeleteByLexemeID(_ context.Context, userID int64, lexemeID string) error {
	delete(r.store, userKey(userID, lexemeID))
	return nil
}

func key(lexeme *entity.LearnedLexeme) string {
	return userKey(lexeme.UserID, lexeme.LexemeID)
}

func userKey(userID int64, lexemeID string) string {
	return fmt.Sprintf("%d:%s", userID, lexemeID)
}

func TestCollectLexemeCreatesAndUpdates(t *testing.T) {
	repo := newInMemoryLearnedRepo()
	uc := NewLearnedLexemeUsecase(repo)

	payload := &entity.LearnedLexeme{
		LexemeID:    "L-test",
		DisplayTerm: "Test",
		Language:    entity.LanguageEnglish,
		CreatedBy:   "user",
	}

	now := time.Now()
	got, err := uc.CollectLexeme(context.Background(), 1, payload)
	if err != nil {
		t.Fatalf("CollectLexeme create returned error: %v", err)
	}
	if got.QueryCount != 1 {
		t.Fatalf("expected query count=1, got %d", got.QueryCount)
	}

	payload.Note = "updated"
	payload.QueryCount = 5
	payload.CreatedAt = now
	payload.UpdatedAt = now

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
	repo := newInMemoryLearnedRepo()
	uc := NewLearnedLexemeUsecase(repo)

	entry := &entity.LearnedLexeme{
		UserID:    2,
		LexemeID:  "L-42",
		CreatedBy: "user",
	}
	entry.Normalize(time.Now())
	if _, err := repo.Create(context.Background(), entry); err != nil {
		t.Fatalf("seed create failed: %v", err)
	}

	result, err := uc.UpdateMastery(context.Background(), 2, "L-42", entity.MasteryBreakdown{Overall: 10}, entity.ReviewTiming{IntervalDays: 3}, map[string]entity.FormMastery{
		"form": {FormID: "form", Strength: 1},
	}, "note")
	if err != nil {
		t.Fatalf("UpdateMastery failed: %v", err)
	}
	if result.Mastery.Overall != 10 || result.Note != "note" {
		t.Fatalf("update did not persist changes")
	}
}
