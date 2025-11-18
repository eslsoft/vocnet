package usecase

import (
	"context"
	"log/slog"
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

// SurfaceToLemmasMap captures the 1:N relationship between a queried surface term
// and every possible storage term (lemma or inflection) that might represent it.
type SurfaceToLemmasMap map[string][]string

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
	termToStore := word.Term // default to the user's input

	// Use BatchLookupFormInfo to ensure consistency with ListLearnedWords
	// Query both lowercase and capitalized variants to check for proper nouns
	variants := []string{strings.ToLower(word.Term), capitalize(word.Term)}
	formInfosMap, err := u.lexemeRepo.BatchLookupFormInfo(ctx, variants, language)
	if err != nil {
		return nil, err
	}

	formInfos := formInfosMap[word.Term]
	// Determine if this word requires case-sensitive matching
	caseSensitive := isCaseSensitiveWord(formInfosMap)
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
		existing.CaseSensitive = caseSensitive
		existing.Normalize(now)
		return u.repo.Update(ctx, existing)
	}

	// Create new learned word
	copy := *word
	copy.Term = termToStore
	copy.CaseSensitive = caseSensitive
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
	surfaceMap, originalTerms, err := u.prepareSurfaceTerms(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	results, total, err := u.repo.List(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	populateMatchedTerms(results, surfaceMap, originalTerms)

	return results, total, nil
}

func (u *learnedWordUsecase) prepareSurfaceTerms(ctx context.Context, query *repository.ListLearnedWordQuery) (SurfaceToLemmasMap, []string, error) {
	if query == nil || len(query.SurfaceTerms) == 0 {
		return nil, nil, nil
	}

	original := append([]string{}, query.SurfaceTerms...)
	language := entity.ParseLanguage(query.Language)

	mappedTerms, mapping, err := u.MapSurfaceTermsToStorageTerms(ctx, query.SurfaceTerms, language)
	if err != nil {
		return nil, nil, err
	}

	// No need to expand case variants - database queries are now case-insensitive
	query.SurfaceTerms = mappedTerms
	return mapping, original, nil
}

func populateMatchedTerms(results []entity.LearnedWord, surfaceMap SurfaceToLemmasMap, original []string) {
	if len(surfaceMap) == 0 || len(original) == 0 || len(results) == 0 {
		return
	}

	for i := range results {
		results[i].MatchedTerms = matchSurfaceTerms(results[i], surfaceMap, original)
	}
}

func matchSurfaceTerms(word entity.LearnedWord, surfaceMap SurfaceToLemmasMap, original []string) []string {
	matchedTerms := make([]string, 0, 2)
	seen := make(map[string]struct{}, len(original))

	for _, surface := range original {
		if _, alreadyMatched := seen[surface]; alreadyMatched {
			continue
		}

		candidates := surfaceMap[surface]
		if len(candidates) == 0 {
			slog.Debug("empty candidates for surface term, skipping",
				"surface", surface,
				"storedTerm", word.Term)
			continue
		}

		shouldMatch := matchesSurfaceTerm(word, surface, candidates)
		slog.Debug("matchedTerms: evaluating surface",
			"surface", surface,
			"storedTerm", word.Term,
			"caseSensitive", word.CaseSensitive,
			"candidates", candidates,
			"matched", shouldMatch)

		if shouldMatch {
			matchedTerms = append(matchedTerms, surface)
			seen[surface] = struct{}{}
		}
	}

	return matchedTerms
}

// matchesSurfaceTerm determines if a stored word matches a user's surface query term.
// For case-sensitive words, the surface term or its candidates must exactly match the stored term.
// For case-insensitive words, matching is done without regard to case.
func matchesSurfaceTerm(word entity.LearnedWord, surface string, candidates []string) bool {
	if word.CaseSensitive {
		// For case-sensitive words, require exact case match
		// Check if the surface term itself matches
		if word.Term == surface {
			return true
		}
		// Check if any candidate matches exactly
		for _, candidate := range candidates {
			if word.Term == candidate {
				return true
			}
		}
		return false
	}

	// For case-insensitive words, match without regard to case
	// Check if the surface term matches (case-insensitive)
	if strings.EqualFold(word.Term, surface) {
		return true
	}
	// Check if any candidate matches (case-insensitive)
	for _, candidate := range candidates {
		if strings.EqualFold(word.Term, candidate) {
			return true
		}
	}
	return false
}

func (u *learnedWordUsecase) DeleteLearnedWord(ctx context.Context, userID int64, id int64) error {
	if id == 0 {
		return entity.ErrLearnedWordNotFound
	}
	return u.repo.DeleteByID(ctx, userID, id)
}

// MapSurfaceTermsToStorageTerms converts each queried surface form into
// all possible storage terms (lemmas or inflections) that should be checked.
// Returns (deduplicated storage terms to query, surface → lemmas mapping, error).
func (u *learnedWordUsecase) MapSurfaceTermsToStorageTerms(ctx context.Context, surfaceTerms []string, language entity.Language) ([]string, SurfaceToLemmasMap, error) {
	if len(surfaceTerms) == 0 {
		return surfaceTerms, nil, nil
	}

	// Filter out empty/whitespace-only terms upfront
	filteredTerms := make([]string, 0, len(surfaceTerms))
	for _, term := range surfaceTerms {
		if strings.TrimSpace(term) != "" {
			filteredTerms = append(filteredTerms, term)
		}
	}

	if len(filteredTerms) == 0 {
		return nil, nil, nil
	}

	// Normalize language, default to English
	language = entity.NormalizeLanguage(language)
	if language == entity.LanguageUnspecified {
		language = entity.LanguageEnglish
	}

	formInfosMap, err := u.lexemeRepo.BatchLookupFormInfo(ctx, filteredTerms, language)
	if err != nil {
		return nil, nil, err
	}

	termsToQuery := make([]string, 0, len(filteredTerms)*2)
	surfaceToLemmas := make(SurfaceToLemmasMap, len(filteredTerms))

	for _, surface := range filteredTerms {
		formInfos := formInfosMap[surface]
		lemmas := collectPossibleStorageTerms(surface, formInfos)
		surfaceToLemmas[surface] = lemmas
		termsToQuery = append(termsToQuery, lemmas...)

		for _, info := range formInfos {
			slog.Info("MapSurfaceTermsToStorageTermsWithMapping: processing formInfo",
				"surface", surface,
				"formText", info.FormText,
				"formType", info.FormType,
				"lemmaText", info.LemmaText,
				"isIrregular", info.IsIrregular)
		}
	}

	return deduplicateStrings(termsToQuery), surfaceToLemmas, nil
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

// deduplicateStrings removes duplicate strings.
// Note: Input is expected to be already lowercased from collectPossibleStorageTerms.
func deduplicateStrings(items []string) []string {
	if len(items) == 0 {
		return items
	}

	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))

	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; !exists {
			seen[trimmed] = struct{}{}
			result = append(result, trimmed)
		}
	}

	return result
}

// collectPossibleStorageTerms gathers all candidate terms that might match the surface form.
// Returns both original case and lowercase variants to support both case-sensitive and
// case-insensitive matching. Database queries use LOWER(term) IN (...) for case-insensitive
// lookups, while matchedTerms population requires exact case for case-sensitive words.
//
// The function always includes the surface term itself plus all derived lemmas, ensuring
// maximum recall even when lexeme data quality varies.
//
// Note: Empty/whitespace-only surfaces should be filtered out before calling this function.
// If called with empty surface, returns empty slice (not nil) for consistency.
func collectPossibleStorageTerms(surface string, formInfos []*repository.LexemeFormInfo) []string {
	trimmedSurface := strings.TrimSpace(surface)
	if trimmedSurface == "" {
		// Return empty slice instead of nil for consistent handling
		return []string{}
	}

	candidates := make([]string, 0, len(formInfos)*2+2)
	seen := make(map[string]struct{}, len(formInfos)*2+2)

	// Include both original case (for case-sensitive matching) and lowercase (for queries)
	// This ensures that case-sensitive words like "Sunday" can be matched correctly
	candidates = appendUniqueCasePreserving(candidates, seen, trimmedSurface)

	for _, info := range formInfos {
		if info == nil || isSelfReferencingLemma(info) {
			continue
		}

		candidate := determineStorageTerm(info)
		candidates = appendUniqueCasePreserving(candidates, seen, candidate)
	}

	return candidates
}

// appendUniqueCasePreserving preserves the original case of terms for proper matching.
// Database queries use LOWER(term) IN (...), so case doesn't affect query results.
// Deduplication is case-insensitive (e.g., "Root" and "root" are considered duplicates).
func appendUniqueCasePreserving(dst []string, seen map[string]struct{}, value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return dst
	}

	lower := strings.ToLower(trimmed)

	// Check if we've already seen this term (case-insensitive)
	if _, exists := seen[lower]; exists {
		return dst
	}

	seen[lower] = struct{}{}

	// Add original case only - database uses LOWER() for queries
	dst = append(dst, trimmed)

	return dst
}

func isSelfReferencingLemma(info *repository.LexemeFormInfo) bool {
	if info == nil {
		return false
	}
	if info.FormType != "LEMMA" {
		return false
	}
	// Use exact match to handle case-sensitive words correctly (e.g., "Polish" vs "polish")
	return strings.TrimSpace(info.FormText) == strings.TrimSpace(info.LemmaText)
}

func determineStorageTerm(info *repository.LexemeFormInfo) string {
	if info == nil {
		return ""
	}

	switch {
	case info.IsIrregular:
		return info.FormText
	case info.FormType != "LEMMA" && info.FormType != "":
		return info.LemmaText
	default:
		return info.FormText
	}
}

// capitalize returns a string with the first letter capitalized and the rest lowercase
func capitalize(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	if len(runes) == 0 {
		return s
	}
	result := strings.ToUpper(string(runes[0]))
	if len(runes) > 1 {
		result += strings.ToLower(string(runes[1:]))
	}
	return result
}

// isCaseSensitiveWord checks if any of the word's case variants contains a proper noun
// indicating that the word should be matched case-sensitively (e.g., polish vs Polish)
func isCaseSensitiveWord(formInfosMap map[string][]*repository.LexemeFormInfo) bool {
	for _, formInfos := range formInfosMap {
		for _, info := range formInfos {
			if strings.Contains(strings.ToLower(info.Pos), "proper") {
				return true
			}
		}
	}
	return false
}
