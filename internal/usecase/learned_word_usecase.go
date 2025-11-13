package usecase

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=learned_word_usecase.go -destination=../mocks/mock_learned_word_usecase.go -package=mocks

// LearnedWordUsecase encapsulates business logic for managing user vocabulary entries.
type LearnedWordUsecase interface {
	CollectWord(ctx context.Context, userID int64, word *entity.LearnedWord) (*entity.LearnedWord, error)
	GetLearnedWord(ctx context.Context, userID int64, id int64) (*entity.LearnedWord, error)
	UpdateMastery(ctx context.Context, userID int64, id int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, notes []string) (*entity.LearnedWord, error)
	ListLearnedWords(ctx context.Context, filter *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteLearnedWord(ctx context.Context, userID int64, id int64) error
}

// NewLearnedWordUsecase wires the repository with default behaviour.
func NewLearnedWordUsecase(repo repository.LearnedWordRepository, lexemeRepo repository.LexemeRepository) LearnedWordUsecase {
	return &learnedWordUsecase{
		repo:       repo,
		lexemeRepo: lexemeRepo,
		clock:      time.Now,
	}
}

type learnedWordUsecase struct {
	repo       repository.LearnedWordRepository
	lexemeRepo repository.LexemeRepository
	clock      func() time.Time
}

func (u *learnedWordUsecase) CollectWord(ctx context.Context, userID int64, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	if word == nil {
		return nil, entity.ErrInvalidLearnedWordText
	}

	language := entity.NormalizeLanguage(word.Language)

	// Determine which term to store based on irregular flag
	// Logic from docs/mastery-inheritance.md:
	// 1. If irregular == true: store the term itself (e.g., "went" → "went")
	// 2. If term_type != LEMMA and irregular == false: store lemma (e.g., "apples" → "apple")
	// 3. If term_type == LEMMA: store the term itself (e.g., "apple" → "apple")
	termToStore := word.Term // default
	formInfo, err := u.lexemeRepo.LookupFormInfo(ctx, word.Term, language)
	if err != nil {
		return nil, err
	}
	if formInfo != nil {
		if formInfo.IsIrregular {
			// Irregular form: store itself
			termToStore = formInfo.FormText
		} else if formInfo.FormType != "LEMMA" && formInfo.FormType != "" {
			// Regular inflected form: store lemma
			termToStore = formInfo.LemmaText
		} else {
			// Lemma or unknown: store itself
			termToStore = formInfo.FormText
		}
	}

	// Check if already collected
	existing, err := u.repo.FindByTerm(ctx, userID, termToStore, language)
	if err != nil {
		return nil, err
	}

	now := u.clock()
	if existing != nil {
		// Update existing record (but don't increment QueryCount - that happens in GetLearnedWord)
		if len(word.Tags) > 0 {
			existing.Tags = append([]string{}, word.Tags...)
		}
		if len(word.Notes) > 0 {
			existing.Notes = append([]string{}, word.Notes...)
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
	copy.Term = termToStore
	copy.UserID = userID
	copy.Language = language
	if copy.QueryCount == 0 {
		copy.QueryCount = 1
	}
	if copy.CreatedBy == "" {
		copy.CreatedBy = "user"
	}
	copy.Normalize(now)

	return u.repo.Create(ctx, &copy)
}

func (u *learnedWordUsecase) GetLearnedWord(ctx context.Context, userID int64, id int64) (*entity.LearnedWord, error) {
	if id == 0 {
		return nil, entity.ErrLearnedWordNotFound
	}

	existing, err := u.repo.GetByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}

	// Increment query count each time the word is retrieved
	existing.QueryCount++
	existing.UpdatedAt = u.clock()

	return u.repo.Update(ctx, existing)
}

func (u *learnedWordUsecase) UpdateMastery(ctx context.Context, userID int64, id int64, mastery entity.MasteryBreakdown, review entity.ReviewTiming, notes []string) (*entity.LearnedWord, error) {
	if id == 0 {
		return nil, entity.ErrLearnedWordNotFound
	}

	existing, err := u.repo.GetByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}

	existing.Mastery = mastery
	existing.Review = review
	if len(notes) > 0 {
		existing.Notes = append([]string{}, notes...)
	}
	existing.Normalize(u.clock())

	return u.repo.Update(ctx, existing)
}

func (u *learnedWordUsecase) ListLearnedWords(ctx context.Context, query *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
	// Apply business logic: map surface terms to storage terms
	// This implements mastery-inheritance.md: regular forms → lemma, irregular → itself
	if len(query.SurfaceTerms) > 0 {
		language := entity.ParseLanguage(query.Language)
		mappedTerms, err := u.MapSurfaceTermsToStorageTerms(ctx, query.SurfaceTerms, language)
		if err != nil {
			return nil, 0, err
		}
		query.SurfaceTerms = mappedTerms
	}

	return u.repo.List(ctx, query)
}

func (u *learnedWordUsecase) DeleteLearnedWord(ctx context.Context, userID int64, id int64) error {
	if id == 0 {
		return entity.ErrLearnedWordNotFound
	}
	return u.repo.DeleteByID(ctx, userID, id)
}

// MapSurfaceTermsToStorageTerms converts surface forms to the terms we actually store.
// This encapsulates the business rule: regular inflections store lemma, irregular forms store themselves.
func (u *learnedWordUsecase) MapSurfaceTermsToStorageTerms(ctx context.Context, surfaceTerms []string, language entity.Language) ([]string, error) {
	if len(surfaceTerms) == 0 {
		return surfaceTerms, nil
	}

	// Normalize language, default to English
	language = entity.NormalizeLanguage(language)
	if language == entity.LanguageUnspecified {
		language = entity.LanguageEnglish
	}

	// Batch lookup form information
	formInfos, err := u.lexemeRepo.BatchLookupFormInfo(ctx, surfaceTerms, language)
	if err != nil {
		return nil, err
	}

	// Map each surface term to its storage term using the same logic as CollectWord
	termsToQuery := make([]string, 0, len(surfaceTerms))
	for _, surface := range surfaceTerms {
		termToStore := surface // default

		formInfo, exists := formInfos[surface]
		if exists {
			// Apply storage strategy: same logic as in CollectWord
			if formInfo.IsIrregular {
				// Irregular form: store/query the form itself
				termToStore = formInfo.FormText
			} else if formInfo.FormType != "LEMMA" && formInfo.FormType != "" {
				// Regular inflection: store/query the lemma
				termToStore = formInfo.LemmaText
			} else {
				// Lemma or unknown: store/query the form itself
				termToStore = formInfo.FormText
			}
		}

		termsToQuery = append(termsToQuery, termToStore)
	}

	// Deduplicate and return
	return deduplicateStrings(termsToQuery), nil
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

// deduplicateStrings removes duplicate strings (case-insensitive).
func deduplicateStrings(items []string) []string {
	if len(items) == 0 {
		return items
	}

	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))

	for _, item := range items {
		lower := strings.ToLower(strings.TrimSpace(item))
		if lower == "" {
			continue
		}
		if _, exists := seen[lower]; !exists {
			seen[lower] = struct{}{}
			result = append(result, item)
		}
	}

	return result
}
