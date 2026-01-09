package usecase

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"github.com/eslsoft/vocnet/internal/repository"
)

//go:generate mockgen -source=learned_word_usecase.go -destination=../mocks/mock_learned_word_usecase.go -package=mocks

// LearnedWordUsecase encapsulates business logic for managing user vocabulary entries.
type LearnedWordUsecase interface {
	CollectWord(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error)
	GetLearnedWord(ctx context.Context, id int64) (*entity.LearnedWord, error)
	UpdateMastery(ctx context.Context, id int64, mastery entity.MasteryBreakdown, tags []string, notes []string) (*entity.LearnedWord, error)
	ListLearnedWords(ctx context.Context, filter *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error)
	DeleteLearnedWord(ctx context.Context, id int64) error
	MapSurfaceTermsToStorageTerms(ctx context.Context, surfaceTerms []string, language entity.Language) ([]string, map[string]string, error)
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

func (u *learnedWordUsecase) CollectWord(ctx context.Context, word *entity.LearnedWord) (*entity.LearnedWord, error) {
	if word == nil {
		return nil, entity.ErrInvalidLearnedWordText
	}

	language := entity.NormalizeLanguage(word.Language)
	termToStore := word.Term // Always store exactly what the user provided

	// Lookup form info for the term (for lemma detection)
	formInfosMap, err := u.lexemeRepo.BatchLookupFormInfo(ctx, []string{word.Term}, language)
	if err != nil {
		return nil, err
	}

	formInfos := formInfosMap[word.Term]

	// Identify lemma for auto-creation if it's a regular inflection
	// Logic from docs/design/mastery-inheritance.md
	if isRegularInflection(formInfos) {
		lemmaText := formInfos[0].LemmaText
		// Check if lemma already exists for this user
		existingLemma, err := u.repo.FindByTerm(ctx, word.UserID, lemmaText, language)
		if err != nil {
			return nil, err
		}

		if existingLemma == nil {
			// Auto-create lemma record with same initial mastery
			now := u.clock()
			lemmaWord := &entity.LearnedWord{
				UserID:       word.UserID,
				Term:         lemmaText,
				Language:     language,
				Mastery:      word.Mastery,
				QueriedCount: 1,
				Tags:         append([]string{}, word.Tags...),
			}
			lemmaWord.Mastery.Normalize()
			lemmaWord.Normalize(now)
			if _, err := u.repo.Create(ctx, lemmaWord); err != nil {
				// Log error but continue with storing the original word
				slog.Error("failed to auto-create lemma", "term", word.Term, "lemma", lemmaText, "error", err)
			}
		}
	}

	// Check if already collected (FindByTerm now uses normal field + exact match priority)
	existing, err := u.repo.FindByTerm(ctx, word.UserID, termToStore, language)
	if err != nil {
		return nil, err
	}

	now := u.clock()
	if existing != nil {
		// Only update if it's an exact match (to avoid unique constraint violation)
		if existing.Term == termToStore {
			// Update existing record
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
				existing.Contexts = mergeContexts(existing.Contexts, word.Contexts)
			}
			existing.Normalize(now)
			return u.repo.Update(ctx, existing)
		}
		// Different case variant exists, try to create new record
	}

	// Create new learned word
	copy := *word
	copy.Term = termToStore
	copy.Language = language
	if copy.QueriedCount == 0 {
		copy.QueriedCount = 1
	}
	copy.Mastery.Normalize()
	copy.Normalize(now)

	return u.repo.Create(ctx, &copy)
}

func (u *learnedWordUsecase) GetLearnedWord(ctx context.Context, id int64) (*entity.LearnedWord, error) {
	userID := auth.MustGetUserID(ctx)

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

func (u *learnedWordUsecase) UpdateMastery(ctx context.Context, id int64, mastery entity.MasteryBreakdown, tags []string, notes []string) (*entity.LearnedWord, error) {
	userID := auth.MustGetUserID(ctx)

	if id == 0 {
		return nil, entity.ErrLearnedWordNotFound
	}

	existing, err := u.repo.GetByID(ctx, userID, id)
	if err != nil {
		return nil, err
	}

	existing.Mastery = mastery
	existing.Mastery.Normalize() // Ensure overall is calculated from dimensions
	if len(tags) > 0 {
		existing.Tags = append([]string{}, tags...)
	}
	if len(notes) > 0 {
		existing.Notes = append([]string{}, notes...)
	}
	existing.Normalize(u.clock())

	return u.repo.Update(ctx, existing)
}

func (u *learnedWordUsecase) ListLearnedWords(ctx context.Context, query *repository.ListLearnedWordQuery) ([]entity.LearnedWord, int64, error) {
	mapping, originalTerms, err := u.prepareSurfaceTerms(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	results, total, err := u.repo.List(ctx, query)
	if err != nil {
		return nil, 0, err
	}

	populateMatchedTerms(results, mapping, originalTerms)

	return results, total, nil
}

func (u *learnedWordUsecase) prepareSurfaceTerms(ctx context.Context, query *repository.ListLearnedWordQuery) (map[string]string, []string, error) {
	if query == nil || len(query.SurfaceTerms) == 0 {
		return nil, nil, nil
	}

	original := append([]string{}, query.SurfaceTerms...)
	language := entity.ParseLanguage(query.Language)

	// Only apply mastery inheritance if explicitly enabled
	if !query.AutoInheritMastery {
		// No inheritance: direct 1:1 mapping
		mapping := make(map[string]string, len(query.SurfaceTerms))
		for _, term := range query.SurfaceTerms {
			mapping[term] = term
		}
		return mapping, original, nil
	}

	// With inheritance enabled: map inflections to lemmas
	mappedTerms, mapping, err := u.MapSurfaceTermsToStorageTerms(ctx, query.SurfaceTerms, language)
	if err != nil {
		return nil, nil, err
	}

	query.SurfaceTerms = mappedTerms
	return mapping, original, nil
}

func populateMatchedTerms(results []entity.LearnedWord, mapping map[string]string, original []string) {
	if len(mapping) == 0 || len(original) == 0 || len(results) == 0 {
		return
	}

	for i := range results {
		results[i].MatchedTerms = matchSurfaceTerms(results[i], mapping, original)
	}
}

func matchSurfaceTerms(word entity.LearnedWord, mapping map[string]string, original []string) []string {
	matchedTerms := make([]string, 0, 2)
	seen := make(map[string]struct{}, len(original))

	for _, surface := range original {
		if _, alreadyMatched := seen[surface]; alreadyMatched {
			continue
		}

		lemma := mapping[surface]
		shouldMatch := matchesSurfaceTerm(word, surface, lemma)

		if shouldMatch {
			matchedTerms = append(matchedTerms, surface)
			seen[surface] = struct{}{}
		}
	}

	return matchedTerms
}

// matchesSurfaceTerm determines if a stored word matches a user's surface query term.
// Logic:
// 1. Case-insensitive exact match (using normal field)
// 2. Inheritance match (if surface maps to this word's lemma)
func matchesSurfaceTerm(word entity.LearnedWord, surface string, lemma string) bool {
	surfaceNormal := strings.ToLower(strings.TrimSpace(surface))
	lemmaNormal := strings.ToLower(strings.TrimSpace(lemma))

	// Case-insensitive exact match
	if word.Normal == surfaceNormal {
		return true
	}

	// Case-insensitive inheritance match
	return word.Normal == lemmaNormal
}

func (u *learnedWordUsecase) DeleteLearnedWord(ctx context.Context, id int64) error {
	userID := auth.MustGetUserID(ctx)

	if id == 0 {
		return entity.ErrLearnedWordNotFound
	}
	return u.repo.DeleteByID(ctx, userID, id)
}

// MapSurfaceTermsToStorageTerms converts each queried surface form into
// its storage candidates (surface itself and lemma if applicable).
// Returns (deduplicated storage terms to query, surface → lemma mapping, error).
func (u *learnedWordUsecase) MapSurfaceTermsToStorageTerms(ctx context.Context, surfaceTerms []string, language entity.Language) ([]string, map[string]string, error) {
	if len(surfaceTerms) == 0 {
		return surfaceTerms, nil, nil
	}

	filteredTerms := make([]string, 0, len(surfaceTerms))
	for _, term := range surfaceTerms {
		if strings.TrimSpace(term) != "" {
			filteredTerms = append(filteredTerms, term)
		}
	}

	if len(filteredTerms) == 0 {
		return nil, nil, nil
	}

	language = entity.NormalizeLanguage(language)
	if language == entity.LanguageUnspecified {
		language = entity.LanguageEnglish
	}

	formInfosMap, err := u.lexemeRepo.BatchLookupFormInfo(ctx, filteredTerms, language)
	if err != nil {
		return nil, nil, err
	}

	termsToQuery := make([]string, 0, len(filteredTerms)*2)
	mapping := make(map[string]string, len(filteredTerms))

	for _, surface := range filteredTerms {
		formInfos := formInfosMap[surface]

		// Always include surface itself for exact match priority
		termsToQuery = append(termsToQuery, surface)

		if isRegularInflection(formInfos) {
			lemma := formInfos[0].LemmaText
			mapping[surface] = lemma
			termsToQuery = append(termsToQuery, lemma)
		} else {
			// No inheritance mapping for lemmas or irregular forms
			mapping[surface] = surface
		}
	}

	return deduplicateStrings(termsToQuery), mapping, nil
}

// isRegularInflection checks if the form info indicates a simple regular inflection.
func isRegularInflection(infos []*repository.LexemeFormInfo) bool {
	if len(infos) != 1 {
		return false
	}
	info := infos[0]
	return !info.IsIrregular &&
		info.FormType != "LEMMA" &&
		info.FormType != "" &&
		!strings.EqualFold(info.FormText, info.LemmaText)
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
