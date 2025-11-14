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

	// Use BatchLookupFormInfo to ensure consistency with ListLearnedWords
	formInfosMap, err := u.lexemeRepo.BatchLookupFormInfo(ctx, []string{word.Term}, language)
	if err != nil {
		return nil, err
	}

	formInfos := formInfosMap[word.Term]
	// Default: keep user's input
	termToStore = word.Term
	
	// Only map to lemma if it's CLEARLY a simple regular inflection
	// (not irregular, not a lemma itself, and has a different lemma)
	if len(formInfos) == 1 {
		info := formInfos[0]
		if !info.IsIrregular && 
		   info.FormType != "LEMMA" && 
		   info.FormType != "" &&
		   !strings.EqualFold(info.FormText, info.LemmaText) {
			// Simple case: single regular inflection with different lemma
			// e.g., "apples" → "apple"
			termToStore = info.LemmaText
		}
	}
	// For all other cases (irregular, lemma, multiple forms, unknown), keep user's input

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
	if copy.QueriedCount == 0 {
		copy.QueriedCount = 1
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
	existing.QueriedCount++
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
	var surfaceToStorageMap map[string]string
	var originalSurfaceTerms []string
	if len(query.SurfaceTerms) > 0 {
		// Save original surface terms before mapping
		originalSurfaceTerms = append([]string{}, query.SurfaceTerms...)

		language := entity.ParseLanguage(query.Language)
		mappedTerms, mapping, err := u.MapSurfaceTermsToStorageTermsWithMapping(ctx, query.SurfaceTerms, language)
		if err != nil {
			return nil, 0, err
		}
		query.SurfaceTerms = mappedTerms
		surfaceToStorageMap = mapping
	}

	results, total, err := u.repo.List(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	// If we have a storage-to-surface mapping, set MatchedTerms for each result
	// The mapping is already storage → surface from MapSurfaceTermsToStorageTermsWithMapping
	if len(surfaceToStorageMap) > 0 {
		// Build a set of original surface terms for matching (case-insensitive)
		surfaceTermSet := make(map[string]string, len(originalSurfaceTerms))
		for _, term := range originalSurfaceTerms {
			surfaceTermSet[strings.ToLower(term)] = term
		}

		// For each result, collect ALL surface terms that map to this storage term
		for i := range results {
			termLower := strings.ToLower(results[i].Term)
			matchedTerms := make([]string, 0, 2) // typically 1-2 matches

			// Check if the storage term itself was in the original query
			if exactSurface, ok := surfaceTermSet[termLower]; ok {
				matchedTerms = append(matchedTerms, exactSurface)
			}

			// Check all surface terms to see which ones map to this storage term
			for _, surface := range originalSurfaceTerms {
				surfaceLower := strings.ToLower(surface)
				// Skip if already added as exact match
				if surfaceLower == termLower {
					continue
				}
				// Check if this surface term maps to the current storage term
				if mappedStorage, ok := surfaceToStorageMap[surfaceLower]; ok {
					if strings.EqualFold(mappedStorage, results[i].Term) {
						matchedTerms = append(matchedTerms, surface)
					}
				}
			}

			results[i].MatchedTerms = matchedTerms
		}
	}

	return results, total, nil
}

func (u *learnedWordUsecase) DeleteLearnedWord(ctx context.Context, userID int64, id int64) error {
	if id == 0 {
		return entity.ErrLearnedWordNotFound
	}
	return u.repo.DeleteByID(ctx, userID, id)
}

// MapSurfaceTermsToStorageTerms converts surface forms to the terms we actually store.
// This encapsulates the business rule: regular inflections store lemma, irregular forms store themselves.
// A single surface term can map to multiple storage terms (e.g., "learning" → ["learn", "learning"]).
func (u *learnedWordUsecase) MapSurfaceTermsToStorageTerms(ctx context.Context, surfaceTerms []string, language entity.Language) ([]string, error) {
	mappedTerms, _, err := u.MapSurfaceTermsToStorageTermsWithMapping(ctx, surfaceTerms, language)
	return mappedTerms, err
}

// MapSurfaceTermsToStorageTermsWithMapping converts surface forms to storage terms and returns both
// the mapped terms and a map from surface term to storage term.
// Returns: (mappedStorageTerms, surfaceToStorageMap, error)
func (u *learnedWordUsecase) MapSurfaceTermsToStorageTermsWithMapping(ctx context.Context, surfaceTerms []string, language entity.Language) ([]string, map[string]string, error) {
	if len(surfaceTerms) == 0 {
		return surfaceTerms, nil, nil
	}

	// Normalize language, default to English
	language = entity.NormalizeLanguage(language)
	if language == entity.LanguageUnspecified {
		language = entity.LanguageEnglish
	}

	// Batch lookup form information - now returns ALL possible forms per surface term
	formInfosMap, err := u.lexemeRepo.BatchLookupFormInfo(ctx, surfaceTerms, language)
	if err != nil {
		return nil, nil, err
	}

	// Map each surface term to its storage term(s) using the same logic as CollectWord
	termsToQuery := make([]string, 0, len(surfaceTerms))
	surfaceToStorage := make(map[string]string, len(surfaceTerms))
	// Also track storage → surface for reverse lookup (a storage term may come from multiple surfaces)
	storageToFirstSurface := make(map[string]string)

	for _, surface := range surfaceTerms {
		// ALWAYS include the original surface term first
		// This fixes the "axes" problem where we store "axes" but only query ["axis", "axe"]
		termsToQuery = append(termsToQuery, surface)

		// Also track surface → surface for the case where no mapping exists
		storageKey := strings.ToLower(surface)
		if _, exists := storageToFirstSurface[storageKey]; !exists {
			storageToFirstSurface[storageKey] = surface
		}

		formInfos, exists := formInfosMap[surface]
		if !exists || len(formInfos) == 0 {
			// No form info found, map to itself
			surfaceToStorage[surface] = surface
			continue
		}

		// Process ALL form infos for this surface term
		// Add mapped lemmas IN ADDITION to the surface term
		for _, formInfo := range formInfos {
			var termToStore string

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

			// Skip if termToStore is the same as surface (already added)
			if !strings.EqualFold(termToStore, surface) {
				termsToQuery = append(termsToQuery, termToStore)
			}

			// Map surface to storage (first occurrence wins if multiple forms map to same storage)
			if _, exists := surfaceToStorage[surface]; !exists {
				surfaceToStorage[surface] = termToStore
			}
			// Track storage → surface for reverse lookup (first surface term wins)
			storageKey := strings.ToLower(termToStore)
			if _, exists := storageToFirstSurface[storageKey]; !exists {
				storageToFirstSurface[storageKey] = surface
			}
		}
	}

	// Deduplicate and return
	// Return surfaceToStorage for the caller to know which surface terms map to which storage terms
	return deduplicateStrings(termsToQuery), surfaceToStorage, nil
} // mergeContexts appends new contexts to existing ones, avoiding duplicates based on sentence text.
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
