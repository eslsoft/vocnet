package usecase

import (
	"context"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=learned_word_usecase.go -destination=../mocks/mock_learned_word_usecase.go -package=mocks

// LearnedWordUsecase encapsulates business logic for managing user vocabulary entries.
type LearnedWordUsecase interface {
	CollectWord(ctx context.Context, userID int64, word *entity.LearnedWord) (*entity.LearnedWord, error)
	GetLearnedWord(ctx context.Context, userID int64, wordID int64) (*entity.LearnedWord, error)
	UpdateMastery(ctx context.Context, userID int64, wordID int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, note string) (*entity.LearnedWord, error)
	ListLearnedWords(ctx context.Context, filter *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteLearnedWord(ctx context.Context, userID int64, wordID int64) error
}

// NewLearnedWordUsecase wires the repository with default behaviour.
func NewLearnedWordUsecase(repo repository.LearnedWordRepository) LearnedWordUsecase {
	return &learnedWordUsecase{
		repo:  repo,
		clock: time.Now,
	}
}

type learnedWordUsecase struct {
	repo  repository.LearnedWordRepository
	clock func() time.Time
}

func (u *learnedWordUsecase) CollectWord(ctx context.Context, userID int64, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	if word == nil {
		return nil, entity.ErrInvalidLearnedWordText
	}
	wordID := word.WordID
	if wordID == 0 {
		return nil, entity.ErrInvalidLearnedWordText
	}

	// Check if already collected
	existing, err := u.repo.FindByWordID(ctx, userID, wordID)
	if err != nil {
		return nil, err
	}

	now := u.clock()
	if existing != nil {
		// Update existing record (but don't increment QueryCount - that happens in GetLearnedWord)
		if word.DisplayTerm != "" {
			existing.DisplayTerm = word.DisplayTerm
		}
		if word.Language != entity.LanguageUnspecified {
			existing.Language = entity.NormalizeLanguage(word.Language)
		}
		if len(word.Tags) > 0 {
			existing.Tags = append([]string{}, word.Tags...)
		}
		if word.Note != "" {
			existing.Note = word.Note
		}
		if len(word.Relations) > 0 {
			existing.Relations = append([]entity.LearnedWordRelation{}, word.Relations...)
		}
		if len(word.Contexts) > 0 {
			// Append new contexts to existing ones (avoid duplicates based on sentence)
			existing.Contexts = mergeContexts(existing.Contexts, word.Contexts)
		}
		existing.Mastery = word.Mastery
		existing.Review = word.Review
		existing.Normalize(now)
		return u.repo.Update(ctx, existing)
	}

	// Create new learned word
	copy := *word
	copy.WordID = wordID
	copy.UserID = userID
	if copy.QueryCount == 0 {
		copy.QueryCount = 1
	}
	if copy.CreatedBy == "" {
		copy.CreatedBy = "user"
	}
	copy.Normalize(now)

	return u.repo.Create(ctx, &copy)
}

func (u *learnedWordUsecase) GetLearnedWord(ctx context.Context, userID int64, wordID int64) (*entity.LearnedWord, error) {
	if wordID == 0 {
		return nil, entity.ErrLearnedWordNotFound
	}

	existing, err := u.repo.GetByWordID(ctx, userID, wordID)
	if err != nil {
		return nil, err
	}

	// Increment query count each time the word is retrieved
	existing.QueryCount++
	existing.UpdatedAt = u.clock()

	return u.repo.Update(ctx, existing)
}

func (u *learnedWordUsecase) UpdateMastery(ctx context.Context, userID int64, wordID int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, note string) (*entity.LearnedWord, error) {
	if wordID == 0 {
		return nil, entity.ErrLearnedWordNotFound
	}

	existing, err := u.repo.GetByWordID(ctx, userID, wordID)
	if err != nil {
		return nil, err
	}

	existing.Mastery = mastery
	existing.Review = review
	if note != "" {
		existing.Note = note
	}
	existing.Normalize(u.clock())

	return u.repo.Update(ctx, existing)
}

func (u *learnedWordUsecase) ListLearnedWords(ctx context.Context, query *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
	return u.repo.List(ctx, query)
}

func (u *learnedWordUsecase) DeleteLearnedWord(ctx context.Context, userID int64, wordID int64) error {
	if wordID == 0 {
		return entity.ErrLearnedWordNotFound
	}
	return u.repo.DeleteByWordID(ctx, userID, wordID)
}

// mergeContexts appends new contexts to existing ones, avoiding duplicates based on sentence text.
func mergeContexts(existing, new []entity.LearnedWordContext) []entity.LearnedWordContext {
	if len(new) == 0 {
		return existing
	}

	// Build a set of existing sentences for deduplication
	sentenceSet := make(map[string]bool, len(existing))
	for _, ctx := range existing {
		sentenceSet[ctx.Sentence] = true
	}

	// Append only new unique sentences
	result := append([]entity.LearnedWordContext{}, existing...)
	for _, ctx := range new {
		if !sentenceSet[ctx.Sentence] {
			result = append(result, ctx)
			sentenceSet[ctx.Sentence] = true
		}
	}

	return result
}
